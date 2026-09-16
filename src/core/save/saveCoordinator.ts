// saveCoordinator.ts
//
// SaveCoordinator (slice 10): the only module that writes a project file, and
// the only owner of write ordering. It reads Books through the port and never
// touches CodeMirror, so the same code serves Tauri and the Web — only the
// `FileSystem` Layer differs.
//
// What it owns:
//
//   * `save` — snapshot-bound. The stamp and the text are captured ONCE; the
//     receipt and the baseline name that exact text, so edits that land during
//     the write stay dirty instead of being silently promoted.
//   * `serialize(path)` — one queue per path. Two explicit saves and a
//     `saveAll` cannot interleave writes to the same file.
//   * the baselines — one per successful write, plus the one `adopt` seeds
//     when a book is opened from disk; the contract Diff consumes and
//     Recovery asks about.
//   * conflicts — an external change that really differs from the baseline
//     blocks saving that book until the user resolves it. Sefer surfaces
//     external changes; it never auto-merges.
//
// Serialisation style (open question 2 of the editor-and-save seams, now
// closed): Sefer writes back the DOMINANT form it read. `decode` records the
// file's majority line ending and whether it carried a byte order mark on
// `Source.form`, the text in memory stays canonical LF, and `encode` re-applies
// the form on the way out. The form is never an identity: baselines, diffs,
// stamps and external-change comparison all speak canonical text, so a book
// saved as CRLF is the same text as the same book saved as LF.
//
// Nothing here writes on its own. The only automatic write in the product is
// Recovery's journal, which is a backup and not the file; the project file is
// written by an explicit `save`/`saveAll` — which today means Save & Review.
//
// The engine hash is optional throughout: core computes no hash. Composition
// passes `hasher` once `src/core/galley` exposes the engine's xxh3, and from
// then on dirty comparison and external-change comparison use the hash across
// sessions while the revision keeps deciding within one.

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

import { trustedBy, type Book, type BookId } from "../book/book";
import { writeFileAtomic } from "../fileSystem/atomic";
import { Observability } from "../observability";
import { Recovery } from "../recovery/recovery";
import { decode, encode, type SourceStamp } from "../source/source";
import type { Baseline } from "./baseline";

/** What one successful write did. Git commits receipts, never guesses. */
export interface SaveReceipt {
  readonly bookId: BookId;
  readonly path: string;
  /** The stamp of the text that was written. */
  readonly stamp: SourceStamp;
  /** The engine hash of that text, when a hasher was configured. */
  readonly hash?: bigint;
  /** Byte length of the bytes actually written, in the file's own form. */
  readonly bytes: number;
  readonly at: number;
}

export type SaveFailure =
  | "PermissionDenied"
  | "DiskFull"
  /** The file changed under us and the difference is unresolved. */
  | "Conflict"
  /** The write path refused: a revert the rules would not admit, or no Book. */
  | "Refused"
  | "Io";

export class SaveError extends Data.TaggedError("SaveError")<{
  readonly reason: SaveFailure;
  readonly bookId: BookId;
  readonly path: string;
  readonly description: string;
}> {}

/**
 * A file changed under us. Kept structural on purpose: Project (slice 09) owns
 * the watcher and the real type; Save only needs these three fields, and
 * depending on Project would invert the seam.
 */
export interface ExternalChange {
  readonly bookId: BookId;
  readonly path: string;
  readonly kind: "changed" | "removed";
}

/** The part of Project `externalChanges` needs, structurally. */
export interface ExternalChangeSource {
  readonly books: readonly Book[];
  externalChanges(): Stream.Stream<ExternalChange>;
}

export type ResolveChoice = "keepMine" | "takeDisk" | "compare";

export interface SaveCoordinatorService {
  /**
   * Writes one Book atomically and promotes the written text to its baseline.
   * Fails with `Conflict` when an unresolved external change is recorded for
   * the book: overwriting a file that moved under us is the one thing save
   * must never do quietly.
   */
  readonly save: (book: Book) => Effect.Effect<SaveReceipt, SaveError>;
  /**
   * Seeds the baseline from the book's CURRENT text, as "what disk holds".
   *
   * Why this exists: a baseline is what Save last wrote, and `dirty` treats a
   * missing one as dirty — nothing has been written, so everything is
   * unsaved. That is right for a book Sefer created, and wrong for a book
   * Sefer just READ: the text in hand IS the bytes on disk, so the honest
   * baseline is already known and nobody should see an untouched book marked
   * unsaved. Call it once where a book is opened from disk (the shell does, in
   * `ProjectContext.focus`), and `dirty` becomes the only question anyone has
   * to ask.
   *
   * Adopting is refused — quietly, it is not an error — when a baseline
   * already exists (a real write, or a second open of the same book) or when
   * the book's revision is past 0. A revision past 0 means something has
   * applied since the read (a Recovery replay, a fix), and that text is
   * genuinely not on disk; adopting it would promote unsaved work to saved.
   */
  readonly adopt: (book: Book) => Effect.Effect<void>;
  /** What was last written for this book, if anything was. */
  readonly baseline: (book: Book) => Option.Option<Baseline>;
  /**
   * Whether the book differs from what was written. No baseline means dirty:
   * nothing has been saved, so everything is unsaved. Within a session the
   * revision decides; when both the baseline and the current text have an
   * engine hash, the hash decides — a same-length, same-revision-count
   * replacement can never pass as saved.
   */
  readonly dirty: (book: Book) => boolean;
  /**
   * The external changes that REALLY differ from what we wrote: each candidate
   * is read back and compared against the baseline, so a save of our own bytes
   * (or a touch that changed nothing) is dropped rather than shown. Every
   * surviving change marks its book conflicted until `resolve`.
   */
  readonly externalChanges: (source: ExternalChangeSource) => Stream.Stream<ExternalChange>;
  /**
   * Answers a conflict. `keepMine` clears it, so the next save overwrites.
   * `takeDisk` re-reads the file and submits it as ONE trusted `revert`
   * through `book.apply` — the funnel, never a text assignment. `compare`
   * changes nothing and hands back the on-disk text as a Baseline-shaped
   * value for Diff; the other two choices return `None`.
   */
  readonly resolve: (
    change: ExternalChange,
    choice: ResolveChoice,
  ) => Effect.Effect<Option.Option<Baseline>, SaveError>;
  /** The per-path write queue. Save is the only owner of write ordering. */
  readonly serialize: (
    path: string,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  /** One receipt per dirty book, in order. A failure stops the run. */
  readonly saveAll: (books: readonly Book[]) => Effect.Effect<readonly SaveReceipt[], SaveError>;
}

export class SaveCoordinator extends Context.Service<SaveCoordinator, SaveCoordinatorService>()(
  "SaveCoordinator",
) {}

export interface SaveCoordinatorOptions {
  /**
   * The engine's content hash, when composition has the Galley Layer. Core
   * computes no hash; without this, identity is the revision only.
   */
  readonly hasher?: (text: string) => bigint;
  /**
   * Run after a successful write, on the same fiber, once the bytes are on
   * disk. Composition's hook for the things that describe a file rather than
   * contain it — today the Scripture Burrito ingredient checksums
   * (`src/core/resources/checksum.ts`), which are wrong the moment a book is
   * saved and which Save itself must not know about.
   *
   * Every write goes through `save`, which is why this is an option here
   * rather than a decorator around the service: a wrapper outside could be
   * bypassed by the one caller that matters. A failure is ignored — the
   * project's own bytes are already written.
   */
  readonly onSaved?: (receipt: SaveReceipt) => Effect.Effect<void, unknown>;
}

/**
 * `effect/FileSystem` normalises host errors into a fixed set of tags that has
 * no "disk full" member, so the one failure users must be told about honestly
 * is recognised from the syscall text the host preserved.
 */
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
    /** Unresolved external changes; a book in here refuses to be saved. */
    const conflicts = new Map<BookId, ExternalChange>();
    /** Books this coordinator has seen, so `resolve` can reach the funnel. */
    const seen = new Map<BookId, Book>();
    /** One permit per path: the write queue. */
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
      // The revision FIRST, because it is a number and the hash is a parse.
      // Revision only moves when an edit was accepted, so an unmoved one means
      // the text is the baseline's text and nothing needs hashing to say so.
      // This is read reactively, once per badged book per keystroke: hashing
      // first cost a full engine parse of every untouched book on screen.
      if (source.stamp.revision === baseline.stamp.revision) return false;
      // Moved, so the text MAY differ — or may have been edited and undone
      // back to what was written, which only the hash can tell.
      if (baseline.hash !== undefined && hasher !== undefined)
        return hasher(source.text) !== baseline.hash;
      return true;
    };

    /**
     * See the port's comment. An Effect rather than a plain function because
     * every other entry point here is one and the caller already has a
     * program in hand at open time; nothing in it is asynchronous.
     */
    const adopt = (book: Book): Effect.Effect<void> =>
      Effect.sync(() => {
        remember(book);
        if (baselines.has(book.id)) return;
        const source = book.source();
        if (source.stamp.revision !== 0) {
          observability?.note("save.adopt", "declined", "not a baseline revision", {
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
          // When we learned it, not when it was written: Save has no use for
          // the file's mtime and the port's stat is optional on some hosts.
          savedAt: Date.now(),
        });
        observability?.note("save.adopt", "consumed", undefined, {
          "book.id": book.id,
          "book.revision": 0,
        });
      });

    const save = (book: Book): Effect.Effect<SaveReceipt, SaveError> =>
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

        // 1 capture once: the receipt and the baseline name THIS text, whatever
        // the editor does while the bytes are in flight.
        const source = book.source();
        const stamp = source.stamp;
        const text = source.text;
        // 2 out in the form it came in (see the header note on serialisation).
        const bytes = encode(source);
        const hash = hasher?.(text);

        // 3 one queue per path, atomic on every host.
        const stop = observability?.span("save.write", undefined, {
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

        // 4 the receipt
        const at = Date.now();
        const receipt: SaveReceipt = {
          bookId: book.id,
          path: book.path,
          stamp,
          ...(hash === undefined ? {} : { hash }),
          bytes: bytes.length,
          at,
        };
        // 5 the baseline Diff consumes
        baselines.set(book.id, {
          bookId: book.id,
          path: book.path,
          stamp,
          ...(hash === undefined ? {} : { hash }),
          text,
          savedAt: at,
        });
        // 6 counts and codes only
        observability?.note("save", "rewrote", undefined, {
          "book.id": book.id,
          "book.revision": stamp.revision,
          "fs.bytes": bytes.length,
        });
        // 7 the journal up to this stamp is obsolete. A Recovery that cannot
        // compact is noted, never fatal: the bytes are already on disk.
        if (recovery !== undefined) {
          const compacted = yield* Effect.result(recovery.compact(book.id, stamp));
          if (Result.isFailure(compacted))
            observability?.note("save", "declined", compacted.failure.reason, {
              "book.id": book.id,
              "save.stage": "compact",
            });
        }
        // 8 what composition hangs off a completed write (see `onSaved`).
        if (options.onSaved !== undefined) yield* Effect.ignore(options.onSaved(receipt));
        return receipt;
      });

    /** Reads the file back and says whether it differs from what we wrote. */
    const reallyDiffers = (change: ExternalChange): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        if (change.kind === "removed") return true;
        const baseline = baselines.get(change.bookId);
        // Never written by us: we cannot prove the disk matches what the book
        // was opened from, so surface it rather than assume it is ours.
        if (baseline === undefined) return true;
        const read = yield* Effect.result(fileSystem.readFile(change.path));
        if (Result.isFailure(read)) return true;
        const decoded = decode(read.success);
        if (Result.isFailure(decoded)) return true;
        const onDisk = decoded.success.text;
        if (baseline.hash !== undefined && hasher !== undefined)
          return hasher(onDisk) !== baseline.hash;
        // Canonical-text equality: `decode` has already normalised newlines on
        // both sides, so this compares content, not encoding.
        return onDisk !== baseline.text;
      });

    /** The on-disk text as a Baseline-shaped value, for `compare` and `takeDisk`. */
    const readDisk = (change: ExternalChange): Effect.Effect<Baseline, SaveError> =>
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
          // When we read it, not when it was written: Save has no use for the
          // file's mtime and the port's stat is optional on some hosts.
          savedAt: Date.now(),
        };
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
              observability?.note("save.external", "declined", undefined, {
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
            observability?.note("save.resolve", "consumed", undefined, {
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
          const disk = yield* readDisk(change);
          // ONE change replacing the whole text, through the funnel: the
          // editor's rules judge it, history records one event, and every
          // reader sees it publish like any other edit.
          const applied = book.apply(
            [{ from: 0, to: book.source().text.length, insert: disk.text }],
            "revert",
            trustedBy("save.takeDisk"),
          );
          if (Result.isFailure(applied))
            return yield* Effect.fail(
              refuse(book, "Refused", `revert refused by ${applied.failure.rule}`),
            );
          conflicts.delete(change.bookId);
          // The disk text is now what both sides hold, so it is the baseline;
          // its stamp is the book's post-revert stamp, not the decoded 0.
          baselines.set(book.id, { ...disk, stamp: book.source().stamp, savedAt: Date.now() });
          observability?.note("save.resolve", "rewrote", undefined, {
            "book.id": book.id,
            "save.choice": "takeDisk",
          });
          return Option.none();
        }),

      serialize,

      saveAll: (books) =>
        Effect.forEach(books.filter(dirty), (book) => save(book), { concurrency: 1 }),
    };
  });

/**
 * The SaveCoordinator layer. `Observability` and `Recovery` are taken through
 * `serviceOption` at build time, so a composition without them still saves —
 * it just records nothing and journals nothing.
 */
export const SaveCoordinatorLive = (
  options: SaveCoordinatorOptions = {},
): Layer.Layer<SaveCoordinator, never, FileSystem.FileSystem> =>
  Layer.effect(SaveCoordinator, make(options));
