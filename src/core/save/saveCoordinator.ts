import { trustedBy, type Book, type BookId, type Origin } from "@sefer/text/book";
import { decode, encode, type SourceStamp } from "@sefer/text/source";
import {
  Context,
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  PlatformError,
  Result,
  Semaphore,
  Stream,
} from "effect";

import { writeFileAtomic } from "../fileSystem/atomic";
import { Observability, type ObservabilityService } from "../observability";
import type { ExternalChange } from "../project/project";
import { Recovery } from "../recovery/recovery";
import type { Baseline } from "./baseline";

const takeReason = (
  expect: SourceStamp | "keep" | undefined,
  moved: boolean,
): string | undefined => {
  if (expect === "keep") return "baseline only";
  return moved ? "book moved" : undefined;
};

export interface SaveReceipt {
  readonly bookId: BookId;
  readonly path: string;
  readonly stamp: SourceStamp;
  readonly hash?: bigint;
  readonly bytes: number;
  readonly at: number;
  readonly also: readonly string[];
}

type SaveFailure = "PermissionDenied" | "DiskFull" | "Conflict" | "Refused" | "Io";

class SaveError extends Data.TaggedError("SaveError")<{
  readonly reason: SaveFailure;
  readonly bookId: BookId;
  readonly path: string;
  readonly description: string;
}> {}

export interface ExternalChangeSource {
  readonly books: readonly Book[];
  externalChanges(): Stream.Stream<ExternalChange>;
}

export type ResolveChoice = "keepMine" | "takeDisk" | "compare";

export interface SaveCoordinatorService {
  readonly save: (book: Book) => Effect.Effect<SaveReceipt, SaveError>;
  readonly adopt: (book: Book) => Effect.Effect<void>;
  readonly baseline: (book: Book) => Option.Option<Baseline>;
  readonly dirty: (book: Book) => boolean;
  readonly externalChanges: (source: ExternalChangeSource) => Stream.Stream<ExternalChange>;
  readonly resolve: (
    change: ExternalChange,
    choice: ResolveChoice,
  ) => Effect.Effect<Option.Option<Baseline>, SaveError>;
  readonly takeDisk: (
    book: Book,
    origin: Origin,
    expect?: SourceStamp | "keep",
  ) => Effect.Effect<boolean, SaveError>;
  readonly forget: () => Effect.Effect<void>;
  readonly serialize: (
    path: string,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly saveAll: (books: readonly Book[]) => Effect.Effect<readonly SaveReceipt[], SaveError>;
}

export class SaveCoordinator extends Context.Service<SaveCoordinator, SaveCoordinatorService>()(
  "SaveCoordinator",
) {}

export interface SaveCoordinatorOptions {
  readonly hasher?: (text: string) => bigint;
  readonly onSaved?: (receipt: SaveReceipt) => Effect.Effect<readonly string[], unknown>;
}

const failureFor = (error: PlatformError.PlatformError): SaveFailure => {
  const reason = error.reason;
  if (reason._tag === "BadArgument") return "Io";
  if (reason._tag === "PermissionDenied") return "PermissionDenied";
  const text = `${reason.syscall ?? ""} ${reason.description ?? ""} ${String(reason.cause ?? "")}`;
  return /ENOSPC|no space|quota/i.test(text) ? "DiskFull" : "Io";
};

const make = (
  options: SaveCoordinatorOptions,
): Effect.Effect<SaveCoordinatorService, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
    const recovery = Option.getOrUndefined(yield* Effect.serviceOption(Recovery));
    const hasher = options.hasher;

    const baselines = new Map<BookId, Baseline>();
    const conflicts = new Map<BookId, ExternalChange>();
    const seen = new Map<BookId, Book>();
    const queues = new Map<string, Semaphore.Semaphore>();

    const remember = (book: Book): void => {
      seen.set(book.id, book);
    };

    const serialize =
      (path: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
        const existing = queues.get(path);
        const queue = existing ?? Semaphore.makeUnsafe(1);
        if (existing === undefined) queues.set(path, queue);
        return Semaphore.withPermit(queue, effect);
      };

    const refuse = (book: Book, reason: SaveFailure, description: string): SaveError =>
      new SaveError({ reason, bookId: book.id, path: book.path, description });

    const dirty = (book: Book): boolean => {
      const baseline = baselines.get(book.id);
      if (baseline === undefined) return true;
      const source = book.source();
      if (source.stamp.revision === baseline.stamp.revision) return false;
      if (baseline.hash !== undefined && hasher !== undefined)
        return hasher(source.text) !== baseline.hash;
      return true;
    };

    const adopt = (book: Book): Effect.Effect<void> =>
      Effect.sync(() => {
        remember(book);
        if (baselines.has(book.id)) return;
        const source = book.source();
        if (source.stamp.revision !== 0) {
          observability?.note("baseline.adopt", "declined", "not a baseline revision", {
            "book.id": book.id,
            "book.revision": source.stamp.revision,
          });
          return;
        }
        baselines.set(book.id, {
          bookId: book.id,
          path: book.path,
          stamp: source.stamp,
          ...(hasher === undefined ? {} : { hash: hasher(source.text) }),
          text: source.text,
          savedAt: Date.now(),
        });
        observability?.note("baseline.adopt", "consumed", undefined, {
          "book.id": book.id,
          "book.revision": 0,
        });
      });

    const save = (book: Book): Effect.Effect<SaveReceipt, SaveError> => {
      const saving = observability?.operation("save", {
        "book.id": book.id,
        "fs.path": book.path,
      });
      return Effect.onExit(saveIn(book, saving ?? observability), (exit) =>
        Effect.sync(() => {
          if (exit._tag === "Success")
            saving?.end("ready", {
              "fs.bytes": exit.value.bytes,
              "book.revision": exit.value.stamp.revision,
            });
          else saving?.end("failed");
        }),
      );
    };

    const saveIn = (
      book: Book,
      observability: ObservabilityService | undefined,
    ): Effect.Effect<SaveReceipt, SaveError> =>
      Effect.gen(function* () {
        remember(book);
        const conflict = conflicts.get(book.id);
        if (conflict !== undefined)
          return yield* Effect.fail(
            refuse(
              book,
              "Conflict",
              `${book.path} was ${conflict.kind} on disk; resolve before saving`,
            ),
          );

        const source = book.source();
        const stamp = source.stamp;
        const text = source.text;
        const bytes = encode(source);
        const hash = hasher?.(text);

        const stop = observability?.span("file.write", undefined, {
          "book.id": book.id,
          "fs.path": book.path,
          "fs.bytes": bytes.length,
        });
        const written = yield* Effect.result(
          serialize(book.path)(writeFileAtomic(fileSystem, book.path, bytes)),
        );
        stop?.();
        if (Result.isFailure(written)) {
          const reason = failureFor(written.failure);
          observability?.note("save", "failed", reason, {
            "book.id": book.id,
            "fs.path": book.path,
          });
          return yield* Effect.fail(refuse(book, reason, written.failure.message));
        }

        const at = Date.now();
        const receipt: SaveReceipt = {
          bookId: book.id,
          path: book.path,
          stamp,
          ...(hash === undefined ? {} : { hash }),
          bytes: bytes.length,
          at,
          also: [],
        };
        baselines.set(book.id, {
          bookId: book.id,
          path: book.path,
          stamp,
          ...(hash === undefined ? {} : { hash }),
          text,
          savedAt: at,
        });
        observability?.note("save", "rewrote", undefined, {
          "book.id": book.id,
          "book.revision": stamp.revision,
          "fs.bytes": bytes.length,
        });
        if (recovery !== undefined) {
          const compacted = yield* Effect.result(recovery.compact(book.id, stamp, hash));
          if (Result.isFailure(compacted))
            observability?.note("save", "declined", compacted.failure.reason, {
              "book.id": book.id,
              "save.stage": "compact",
            });
        }
        if (options.onSaved === undefined) return receipt;
        const also = yield* Effect.orElseSucceed(options.onSaved(receipt), () => []);
        return { ...receipt, also };
      });

    const reallyDiffers = (change: ExternalChange): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        if (change.kind === "removed") return true;
        const baseline = baselines.get(change.bookId);
        if (baseline === undefined) return true;
        const read = yield* Effect.result(fileSystem.readFile(change.path));
        if (Result.isFailure(read)) return true;
        const decoded = decode(read.success);
        if (Result.isFailure(decoded)) return true;
        const onDisk = decoded.success.text;
        if (baseline.hash !== undefined && hasher !== undefined)
          return hasher(onDisk) !== baseline.hash;
        return onDisk !== baseline.text;
      });

    const readDisk = (
      change: Pick<ExternalChange, "bookId" | "path">,
    ): Effect.Effect<Baseline, SaveError> =>
      Effect.gen(function* () {
        const bytes = yield* Effect.mapError(fileSystem.readFile(change.path), (error) => {
          const reason = failureFor(error);
          return new SaveError({
            reason,
            bookId: change.bookId,
            path: change.path,
            description: error.message,
          });
        });
        const decoded = yield* Effect.mapError(
          Effect.fromResult(decode(bytes)),
          (error) =>
            new SaveError({
              reason: "Refused",
              bookId: change.bookId,
              path: change.path,
              description: `the file on disk is not canonical text: ${error.reason}`,
            }),
        );
        return {
          bookId: change.bookId,
          path: change.path,
          stamp: decoded.stamp,
          ...(hasher === undefined ? {} : { hash: hasher(decoded.text) }),
          text: decoded.text,
          savedAt: Date.now(),
        };
      });

    const takeDisk = (
      book: Book,
      origin: Origin,
      expect?: SourceStamp | "keep",
    ): Effect.Effect<boolean, SaveError> =>
      Effect.gen(function* () {
        remember(book);
        const disk = yield* readDisk({ bookId: book.id, path: book.path });
        const stamp = book.source().stamp;
        const moved =
          expect === "keep" ||
          (expect !== undefined &&
            (stamp.revision !== expect.revision || stamp.length !== expect.length));
        const apply = !moved && book.source().text !== disk.text;
        if (apply) {
          const applied = book.apply(
            [{ from: 0, to: book.source().text.length, insert: disk.text }],
            origin,
            trustedBy("save.takeDisk"),
          );
          if (Result.isFailure(applied))
            return yield* Effect.fail(
              refuse(book, "Refused", `${origin} refused by ${applied.failure.rule}`),
            );
        }
        baselines.set(book.id, {
          ...disk,
          stamp: apply || !moved ? book.source().stamp : disk.stamp,
          savedAt: Date.now(),
        });
        const outcome = moved && expect !== "keep" ? "declined" : "rewrote";
        const reason = takeReason(expect, moved);
        observability?.note("baseline.take", outcome, reason, {
          "book.id": book.id,
          "book.origin": origin,
        });
        return apply;
      });

    return {
      save,
      adopt,
      baseline: (book) => Option.fromUndefinedOr(baselines.get(book.id)),
      dirty,

      externalChanges: (source) =>
        Stream.tap(
          Stream.filterEffect(
            Stream.tap(source.externalChanges(), () =>
              Effect.sync(() => {
                for (const book of source.books) remember(book);
              }),
            ),
            reallyDiffers,
          ),
          (change) =>
            Effect.sync(() => {
              conflicts.set(change.bookId, change);
              observability?.note("file.changed", "declined", undefined, {
                "book.id": change.bookId,
                "save.change": change.kind,
              });
            }),
        ),

      resolve: (change, choice) =>
        Effect.gen(function* () {
          if (choice === "compare") return Option.some(yield* readDisk(change));
          if (choice === "keepMine") {
            conflicts.delete(change.bookId);
            observability?.note("conflict.resolve", "consumed", undefined, {
              "book.id": change.bookId,
              "save.choice": "keepMine",
            });
            return Option.none();
          }
          const book = seen.get(change.bookId);
          if (book === undefined)
            return yield* Effect.fail(
              new SaveError({
                reason: "Refused",
                bookId: change.bookId,
                path: change.path,
                description: "no open Book to revert; open it before taking disk",
              }),
            );
          yield* takeDisk(book, "revert");
          conflicts.delete(change.bookId);
          observability?.note("conflict.resolve", "rewrote", undefined, {
            "book.id": book.id,
            "save.choice": "takeDisk",
          });
          return Option.none();
        }),

      takeDisk,

      forget: () =>
        Effect.sync(() => {
          baselines.clear();
          conflicts.clear();
          seen.clear();
        }),

      serialize,

      saveAll: (books) =>
        Effect.forEach(books.filter(dirty), (book) => save(book), { concurrency: 1 }),
    };
  });

export const SaveCoordinatorLive = (
  options: SaveCoordinatorOptions = {},
): Layer.Layer<SaveCoordinator, never, FileSystem.FileSystem> =>
  Layer.effect(SaveCoordinator, make(options));
