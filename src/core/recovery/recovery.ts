import { trustedBy, type Book, type BookId, type Origin, type Receipt } from "@sefer/text/book";
import type { Change, SourceStamp } from "@sefer/text/source";
import { Context, Data, Effect, FileSystem, Layer, Option, Result, Scope } from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath, normalisePath } from "../fileSystem/path";
import { Observability } from "../observability";
import type { Project } from "../project/project";
import type { Baseline } from "../save/baseline";
import { debounced, type DebouncePolicy } from "../schedule/debounce";

export interface JournalEntry {
  readonly before: SourceStamp;
  readonly after: SourceStamp;
  readonly changes: readonly Change[];
  readonly origin: Origin;
  readonly at: number;
}

export interface Restorable {
  readonly id: string;
  readonly projectId: string;
  readonly bookId: BookId;
  readonly path: string;
  readonly lastStamp: SourceStamp;
  readonly entries: readonly JournalEntry[];
  readonly thisSession: boolean;
  readonly base: string | undefined;
  readonly end: string | undefined;
  readonly stale?: boolean;
}

type RecoveryFailure = "NotFound" | "Corrupt" | "BookUnavailable" | "Refused" | "Io";

class RecoveryError extends Data.TaggedError("RecoveryError")<{
  readonly reason: RecoveryFailure;
  readonly id: string;
  readonly description: string;
}> {}

export interface RecoveryService {
  readonly mount: (
    project: Project,
    diskHash: (bookId: BookId) => bigint | undefined,
  ) => () => void;
  readonly pending: (
    baselineOf: (bookId: BookId) => Option.Option<Baseline>,
  ) => Effect.Effect<readonly Restorable[]>;
  readonly restore: (
    id: string,
    resolveBook: (bookId: BookId) => Book | undefined,
  ) => Effect.Effect<Book, RecoveryError>;
  readonly discard: (id: string) => Effect.Effect<void, RecoveryError>;
  readonly setAside: (id: string) => Effect.Effect<string, RecoveryError>;
  readonly compact: (
    bookId: BookId,
    stamp: SourceStamp,
    hash?: bigint,
  ) => Effect.Effect<void, RecoveryError>;
  readonly setPolicy: (policy: DebouncePolicy) => Effect.Effect<void>;
}

export class Recovery extends Context.Service<Recovery, RecoveryService>()("Recovery") {}

export interface RecoveryOptions {
  readonly journalRoot: string;
  readonly policy?: DebouncePolicy;
  readonly cause?: () => string | undefined;
  readonly hasher?: (text: string) => bigint;
}

export const DEFAULT_JOURNAL_POLICY: DebouncePolicy = { idleMs: 500, maxIntervalMs: 5000 };

const JOURNAL_VERSION = 1;

const JOURNAL_SUFFIX = ".jsonl";

interface JournalHeader {
  readonly v: number;
  readonly projectId: string;
  readonly bookId: BookId;
  readonly path: string;
  base?: string;
  end?: string;
}

interface Journal {
  readonly header: JournalHeader;
  entries: JournalEntry[];
}

const journalId = (path: string): string => normalisePath(path).replace(/^\/+/, "");

const idOf = (projectId: string, root: string, path: string): string => {
  const file = normalisePath(path);
  const base = normalisePath(root);
  const inProject = file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
  return journalId(`${projectId}/${inProject}`);
};

const liveOf = (id: string): string => (isAside(id) ? id.slice(0, id.lastIndexOf(ASIDE)) : id);

const ASIDE = "@";
const isAside = (id: string): boolean => id.slice(id.lastIndexOf("/") + 1).includes(ASIDE);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStamp = (value: unknown): value is SourceStamp =>
  isRecord(value) && typeof value.revision === "number" && typeof value.length === "number";

const isChange = (value: unknown): value is Change =>
  isRecord(value) &&
  typeof value.from === "number" &&
  typeof value.to === "number" &&
  typeof value.insert === "string";

const isEntry = (value: unknown): value is JournalEntry =>
  isRecord(value) &&
  isStamp(value.before) &&
  isStamp(value.after) &&
  Array.isArray(value.changes) &&
  value.changes.every(isChange) &&
  typeof value.origin === "string" &&
  typeof value.at === "number";

const isHeader = (value: unknown): value is JournalHeader =>
  isRecord(value) &&
  value.v === JOURNAL_VERSION &&
  typeof value.projectId === "string" &&
  typeof value.bookId === "string" &&
  typeof value.path === "string";

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

const parseJournal = (id: string, text: string): Result.Result<Journal, RecoveryError> => {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const header = parseLine(lines[0] ?? "");
  if (!isHeader(header))
    return Result.fail(
      new RecoveryError({ reason: "Corrupt", id, description: "the header line is not a journal" }),
    );
  const entries: JournalEntry[] = [];
  for (const line of lines.slice(1)) {
    const entry = parseLine(line);
    if (!isEntry(entry))
      return Result.fail(
        new RecoveryError({ reason: "Corrupt", id, description: "an entry line is malformed" }),
      );
    entries.push(entry);
  }
  return Result.succeed({ header, entries });
};

const renderJournal = (journal: Journal): string =>
  [journal.header, ...journal.entries].map((value) => JSON.stringify(value)).join("\n") + "\n";

const ioError = (id: string, description: string): RecoveryError =>
  new RecoveryError({ reason: "Io", id, description });

const make = (
  options: RecoveryOptions,
): Effect.Effect<RecoveryService, never, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
    const root = options.journalRoot;

    const hasher = options.hasher;
    const journals = new Map<string, Journal>();
    const books = new Map<
      BookId,
      { readonly id: string; book: Book; readonly disk: () => bigint | undefined }
    >();
    const unwritten = new Set<string>();
    const owned = new Set<string>();

    const fileFor = (id: string): string => joinPath(root, `${id}${JOURNAL_SUFFIX}`);

    const directoryFor = (id: string): string => joinPath(root, id.slice(0, id.lastIndexOf("/")));

    const write = (id: string, journal: Journal): Effect.Effect<void, RecoveryError> =>
      Effect.mapError(
        Effect.flatMap(fileSystem.makeDirectory(directoryFor(id), { recursive: true }), () =>
          writeFileStringAtomic(fileSystem, fileFor(id), renderJournal(journal)),
        ),
        (error) => ioError(id, error.message),
      );

    const remove = (id: string): Effect.Effect<void, RecoveryError> =>
      Effect.mapError(fileSystem.remove(fileFor(id), { force: true }), (error) =>
        ioError(id, error.message),
      );

    const moveAside = (id: string): Effect.Effect<string | undefined, RecoveryError> =>
      Effect.gen(function* () {
        const found = yield* Effect.result(read(id));
        if (Result.isFailure(found)) {
          if (found.failure.reason === "NotFound") return undefined;
          return yield* Effect.fail(found.failure);
        }
        const last = found.success.entries.at(-1);
        if (last === undefined) {
          yield* remove(id);
          return undefined;
        }
        const aside = `${id}${ASIDE}${last.at}`;
        yield* write(aside, found.success);
        yield* remove(id);
        observability?.note("journal.aside", "rewrote", undefined, {
          "journal.write": aside,
          "journal.entries": found.success.entries.length,
        });
        return aside;
      });

    let causedBy: string | undefined;
    const flush = Effect.gen(function* () {
      const ids = Array.from(unwritten);
      unwritten.clear();
      if (ids.length === 0) return;
      const cause = causedBy;
      causedBy = undefined;
      const writing = observability?.operation(
        "journal.write",
        { "journal.books": ids.length },
        cause === undefined ? undefined : { cause },
      );
      const into = writing ?? observability;
      let failed = 0;
      let entries = 0;
      let cleared = 0;
      for (const id of ids) {
        const journal = journals.get(id);
        if (journal === undefined) continue;
        const held = [...books.values()].find((entry) => entry.id === id);
        if (hasher !== undefined && held !== undefined && journal.entries.length > 0) {
          const now = hasher(held.book.source().text);
          const disk = held.disk();
          if (disk !== undefined && now === disk) {
            journal.entries = [];
            delete journal.header.end;
            cleared += 1;
            into?.note("journal.clear", "consumed", "matches disk", { "journal.write": id });
          } else journal.header.end = String(now);
        }
        if (!owned.has(id)) {
          const moved = yield* Effect.result(moveAside(id));
          if (Result.isFailure(moved)) {
            failed += 1;
            into?.note("journal.write", "failed", moved.failure.reason, { "journal.write": id });
            unwritten.add(id);
            continue;
          }
          owned.add(id);
        }
        const written = yield* Effect.result(
          journal.entries.length === 0 ? remove(id) : write(id, journal),
        );
        if (Result.isFailure(written)) {
          failed += 1;
          into?.note("journal.write", "failed", written.failure.reason, {
            "journal.write": id,
          });
          unwritten.add(id);
        } else {
          entries += journal.entries.length;
          into?.note(
            "journal.write",
            journal.entries.length === 0 ? "consumed" : "rewrote",
            journal.entries.length === 0 ? "removed" : undefined,
            { "journal.write": id, "journal.entries": journal.entries.length },
          );
        }
      }
      writing?.end(failed > 0 ? "failed" : "passed", {
        "journal.failed": failed,
        "journal.entries": entries,
        "journal.cleared": cleared,
      });
    });

    let policy: DebouncePolicy = options.policy ?? DEFAULT_JOURNAL_POLICY;
    const arm = yield* debounced(
      {
        get idleMs() {
          return policy.idleMs;
        },
        get maxIntervalMs() {
          return policy.maxIntervalMs;
        },
      },
      flush,
    );

    const record = (
      id: string,
      projectId: string,
      book: Book,
      receipt: Receipt,
      changes: readonly Change[],
      disk: bigint | undefined,
    ): void => {
      const existing = journals.get(id);
      const journal: Journal = existing ?? {
        header: {
          v: JOURNAL_VERSION,
          projectId,
          bookId: book.id,
          path: book.path,
          ...(disk === undefined ? {} : { base: String(disk) }),
        },
        entries: [],
      };
      if (existing === undefined) journals.set(id, journal);
      journal.entries.push({
        before: receipt.before,
        after: receipt.after,
        changes: [...changes],
        origin: receipt.origin,
        at: Date.now(),
      });
      unwritten.add(id);
      causedBy = options.cause?.() ?? causedBy;
      arm();
    };

    const read = (id: string): Effect.Effect<Journal, RecoveryError> =>
      Effect.flatMap(
        Effect.mapError(fileSystem.readFileString(fileFor(id)), (error) =>
          error.reason._tag === "NotFound"
            ? new RecoveryError({ reason: "NotFound", id, description: "no journal" })
            : ioError(id, error.message),
        ),
        (text) => Effect.fromResult(parseJournal(id, text)),
      );

    const listIds = Effect.map(
      Effect.orElseSucceed(fileSystem.readDirectory(root, { recursive: true }), () => []),
      (names) =>
        names
          .filter((name) => name.endsWith(JOURNAL_SUFFIX) && name.split("/").length >= 2)
          .map((name) => journalId(name.slice(0, -JOURNAL_SUFFIX.length))),
    );

    const prune = (
      id: string,
      journal: Journal,
      stamp: SourceStamp,
      hash: bigint | undefined,
    ): Effect.Effect<void, RecoveryError> => {
      const kept = journal.entries.filter((entry) => entry.after.revision > stamp.revision);
      const base = hash === undefined ? journal.header.base : String(hash);
      if (kept.length === journal.entries.length && base === journal.header.base)
        return Effect.void;
      const compacted: Journal = {
        header: { ...journal.header, ...(base === undefined ? {} : { base }) },
        entries: kept,
      };
      journals.set(id, compacted);
      unwritten.delete(id);
      observability?.note("journal.compact", "rewrote", undefined, {
        "journal.write": id,
        "journal.entries": kept.length,
      });
      return kept.length === 0 ? remove(id) : write(id, compacted);
    };

    return {
      mount: (project, diskHash) => {
        const note = (bookId: BookId, book: Book): void => {
          books.set(bookId, {
            id: idOf(project.id, project.root, book.path),
            book,
            disk: () => diskHash(bookId),
          });
        };
        for (const book of project.books) note(book.id, book);
        const stop = project.edits(({ bookId, book, receipt, changes }) => {
          const known = books.get(bookId);
          if (known === undefined) note(bookId, book);
          else known.book = book;
          const entry = books.get(bookId);
          if (entry !== undefined)
            record(entry.id, project.id, book, receipt, changes, diskHash(bookId));
        });
        observability?.note("journal.mount", "ready", undefined, {
          "project.books": project.books.length,
        });
        return () => {
          stop();
          books.clear();
        };
      },

      pending: (baselineOf) =>
        Effect.gen(function* () {
          const found: Restorable[] = [];
          for (const id of yield* listIds) {
            const journal = yield* Effect.result(read(id));
            if (Result.isFailure(journal)) {
              observability?.note("journal.pending", "declined", journal.failure.reason, {
                "journal.write": id,
              });
              continue;
            }
            const entries = journal.success.entries;
            const last = entries.at(-1);
            if (last === undefined) continue;
            const baseline = baselineOf(journal.success.header.bookId);
            const unsaved =
              Option.isNone(baseline) || last.after.revision > baseline.value.stamp.revision;
            if (!unsaved) continue;
            found.push({
              id,
              projectId: journal.success.header.projectId,
              bookId: journal.success.header.bookId,
              path: journal.success.header.path,
              lastStamp: last.after,
              entries,
              thisSession: journals.has(id),
              base: journal.success.header.base,
              end: journal.success.header.end,
            });
          }
          observability?.note("journal.pending", "ready", undefined, {
            "journal.pending": found.length,
          });
          return found;
        }),

      restore: (given, resolveBook) =>
        Effect.gen(function* () {
          const id = journalId(given);
          const journal = yield* read(id);
          const book = resolveBook(journal.header.bookId);
          if (book === undefined)
            return yield* Effect.fail(
              new RecoveryError({
                reason: "BookUnavailable",
                id,
                description: `no open Book for ${journal.header.bookId}`,
              }),
            );
          const text = book.source();
          const lines =
            hasher !== undefined && journal.header.base !== undefined
              ? String(hasher(text.text)) === journal.header.base
              : (() => {
                  const base = journal.entries[0]?.before;
                  return (
                    base === undefined ||
                    (text.stamp.revision === 0 && base.length === text.stamp.length)
                  );
                })();
          if (!lines) {
            observability?.note("journal.restore", "refused", "text moved", {
              "journal.write": id,
              "book.id": book.id,
            });
            return yield* Effect.fail(
              new RecoveryError({
                reason: "Refused",
                id,
                description: `${journal.header.bookId} is not the text this backup started from (edited since it opened, or the file changed)`,
              }),
            );
          }
          const trust = trustedBy("recovery");
          for (const [index, entry] of journal.entries.entries()) {
            const applied = book.apply(entry.changes, "recovery", trust);
            if (Result.isFailure(applied)) {
              observability?.note("journal.restore", "refused", applied.failure.reason, {
                "journal.write": id,
                "journal.entry": index,
                "book.id": book.id,
              });
              return yield* Effect.fail(
                new RecoveryError({
                  reason: "Refused",
                  id,
                  description: `entry ${index} was refused by ${applied.failure.rule}`,
                }),
              );
            }
          }
          const live = liveOf(id);
          if (isAside(id)) {
            if ((journals.get(live)?.entries.length ?? 0) >= journal.entries.length)
              yield* remove(id);
            else
              observability?.note("journal.restore", "declined", "not journalled", {
                "journal.write": id,
                "book.id": book.id,
              });
          } else {
            journals.set(id, journal);
            owned.add(id);
          }
          observability?.note("journal.restore", "rewrote", undefined, {
            "journal.write": id,
            "journal.entries": journal.entries.length,
            "book.id": book.id,
          });
          return book;
        }),

      discard: (given) =>
        Effect.gen(function* () {
          const id = journalId(given);
          journals.delete(id);
          unwritten.delete(id);
          yield* remove(id);
          observability?.note("journal.discard", "consumed", undefined, {
            "journal.write": id,
          });
        }),

      setAside: (given) =>
        Effect.gen(function* () {
          const id = journalId(given);
          if (isAside(id) || owned.has(id)) return id;
          return (yield* moveAside(id)) ?? id;
        }),

      setPolicy: (next) =>
        Effect.sync(() => {
          policy = next;
        }),

      compact: (bookId, stamp, hash) =>
        Effect.gen(function* () {
          const known = books.get(bookId);
          if (known === undefined) return;
          const live = known.id;
          const inMemory = journals.get(live);
          if (inMemory !== undefined) yield* prune(live, inMemory, stamp, hash);
          else {
            const onDisk = yield* Effect.result(read(live));
            if (Result.isSuccess(onDisk)) yield* prune(live, onDisk.success, stamp, hash);
          }
          for (const id of yield* listIds)
            if (id.startsWith(`${live}${ASIDE}`)) {
              yield* remove(id);
              observability?.note("journal.compact", "consumed", "set aside", {
                "journal.write": id,
              });
            }
        }),
    };
  });

export const RecoveryLive = (
  options: RecoveryOptions,
): Layer.Layer<Recovery, never, FileSystem.FileSystem> => Layer.effect(Recovery, make(options));
