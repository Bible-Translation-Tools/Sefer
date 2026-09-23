// recovery.ts
//
// Recovery: the crash-safety journal. Every accepted edit to a Book
// is appended, debounced, to one JSONL file per project and book OUTSIDE the
// project folder, so Git never sees it and a shared drive never carries it.
// On the next boot, a journal whose last stamp is newer than Save's baseline
// is unsaved work: `pending()` offers it, `restore()` replays it, `discard()`
// throws it away, and `compact()` drops what a successful save made obsolete.
//
// Since the file itself is written only when a version is recorded, this
// journal is the ONLY automatic write in the product. It is the working-state
// backup: it holds what the editor holds, it is not the project file, and it
// is not a version.
//
// Two rules shape the whole module:
//
//   * Recovery never writes the project file. It writes only its own journal;
//     Save owns the project bytes. That is why `restore` replays through
//     `book.apply(…, 'recovery', trustedBy('recovery'))` — a journal written
//     under an older rule set is RE-JUDGED by today's rules, not trusted.
//   * Recovery never runs on the keystroke path. `attach` subscribes to
//     `book.changes` and the listener only pushes an entry into memory and
//     arms a timer; the write happens on a fiber tied to the layer's Scope.
//
// The journal root is a plain string option; the composition feeds it
// `HostInfo.paths().appData`.

import { Context, Data, Effect, FileSystem, Layer, Option, Result, Scope } from "effect";

import { trustedBy, type Book, type BookId, type Origin, type Receipt } from "../book/book";
import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath } from "../fileSystem/path";
import { Observability } from "../observability";
import type { Baseline } from "../save/baseline";
import { debounced, type DebouncePolicy } from "../schedule/debounce";
import type { Change, SourceStamp } from "../source/source";

/** One accepted apply, in the shape the journal line carries. */
export interface JournalEntry {
  readonly before: SourceStamp;
  readonly after: SourceStamp;
  readonly changes: readonly Change[];
  readonly origin: Origin;
  readonly at: number;
}

/** A journal that holds unsaved work, as `pending()` reports it. */
export interface Restorable {
  /** `<projectId>/<bookId>` — the journal's identity and its path stem. */
  readonly id: string;
  readonly projectId: string;
  readonly bookId: BookId;
  /** The project file the entries belong to, recorded when the journal opened. */
  readonly path: string;
  /** The `after` stamp of the last entry: the revision the work reached. */
  readonly lastStamp: SourceStamp;
  readonly entries: readonly JournalEntry[];
}

type RecoveryFailure =
  /** No journal with that id, on disk or in memory. */
  | "NotFound"
  /** The journal file is not the JSONL Recovery writes. */
  | "Corrupt"
  /** `resolveBook` did not hand back a Book for the journal's book id. */
  | "BookUnavailable"
  /** Replay was refused by today's admission rules. */
  | "Refused"
  | "Io";

class RecoveryError extends Data.TaggedError("RecoveryError")<{
  readonly reason: RecoveryFailure;
  readonly id: string;
  readonly description: string;
}> {}

export interface RecoveryService {
  /**
   * Records one accepted apply. `attach` is the ordinary entry point; call
   * this directly only when you already own the `book.changes` subscription,
   * and then pass `projectId` — a book this service has never seen attached
   * has no journal to append to, and a journal with the wrong project
   * identity would be un-restorable, so the misuse dies rather than writes.
   *
   * Never fails and never touches the filesystem: the write is debounced.
   */
  readonly journal: (
    book: Book,
    receipt: Receipt,
    changes: readonly Change[],
    projectId?: string,
  ) => Effect.Effect<void>;
  /**
   * Subscribes to `book.changes` and journals every accepted apply until the
   * Scope closes.
   */
  readonly attach: (book: Book, projectId: string) => Effect.Effect<void, never, Scope.Scope>;
  /**
   * The journals that hold work Save never wrote, newest entry last. A
   * journal counts as pending when `baselineOf(bookId)` is absent (nothing
   * was ever saved) or its last entry's revision is past the baseline's.
   *
   * Never fails: a missing root is no pending work, and an unreadable or
   * corrupt journal is skipped with a `recovery` note. Boot must not stop
   * because crash recovery could not read a file.
   */
  readonly pending: (
    baselineOf: (bookId: BookId) => Option.Option<Baseline>,
  ) => Effect.Effect<readonly Restorable[]>;
  /**
   * Replays a journal onto the Book the caller resolves, in order, as trusted
   * `recovery` applies. Stops at the first refusal: a journal is a record of
   * what was accepted THEN, and a partially replayed book plus an error is
   * honest where a silently skipped entry is not.
   */
  readonly restore: (
    id: string,
    resolveBook: (bookId: BookId) => Book | undefined,
  ) => Effect.Effect<Book, RecoveryError>;
  /** Forgets a journal: the user chose not to restore it. */
  readonly discard: (id: string) => Effect.Effect<void, RecoveryError>;
  /**
   * Drops the entries a successful save made obsolete — everything whose
   * `after` revision is at or before the saved stamp. An emptied journal file
   * is removed. Save calls this in step 7 of `save`.
   */
  readonly compact: (bookId: BookId, stamp: SourceStamp) => Effect.Effect<void, RecoveryError>;
  /**
   * Re-times the backup. The shell calls it with the reader's "Back up work
   * after" preference once settings are readable and again whenever it moves.
   *
   * A setter rather than a Layer option because the debounce fiber is built
   * with the layer and the preference is read from a service above it; the
   * timer re-reads the two bounds on every pass, so a change lands on the next
   * burst without restarting anything.
   */
  readonly setPolicy: (policy: DebouncePolicy) => Effect.Effect<void>;
}

export class Recovery extends Context.Service<Recovery, RecoveryService>()("Recovery") {}

export interface RecoveryOptions {
  /**
   * Directory the journals live under, outside every project. Composition
   * should pass `HostInfo.paths().appData` once that service exists.
   */
  readonly journalRoot: string;
  /** Defaults to 500 ms of quiet, 5 s maximum: off the keystroke path. */
  readonly policy?: DebouncePolicy;
}

export const DEFAULT_JOURNAL_POLICY: DebouncePolicy = { idleMs: 500, maxIntervalMs: 5000 };

const JOURNAL_VERSION = 1;

const JOURNAL_SUFFIX = ".jsonl";

/** The first line of every journal, so a file found on disk is self-describing. */
interface JournalHeader {
  readonly v: number;
  readonly projectId: string;
  readonly bookId: BookId;
  readonly path: string;
}

interface Journal {
  readonly header: JournalHeader;
  entries: JournalEntry[];
}

const idOf = (projectId: string, bookId: BookId): string => `${projectId}/${bookId}`;

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

/** A journal is header line + one entry per line; a bad line makes it Corrupt. */
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

    /** Open journals, by `<projectId>/<bookId>`. */
    const journals = new Map<string, Journal>();
    /** Which project a Book belongs to, learned from `attach`. */
    const projects = new Map<BookId, string>();
    /** Journals whose in-memory entries the flush has not written yet. */
    const unwritten = new Set<string>();

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

    // The flush is the only writer. It rewrites each dirty journal whole:
    // `writeFileAtomic` on the complete file is append-by-rewrite, which at
    // journal scale (one book's unsaved edits) is the simplest correct thing —
    // no partial line can ever be read, and there is no append primitive on
    // the `FileSystem` port to be atomic with.
    const flush = Effect.gen(function* () {
      const ids = Array.from(unwritten);
      unwritten.clear();
      for (const id of ids) {
        const journal = journals.get(id);
        if (journal === undefined) continue;
        const written = yield* Effect.result(
          journal.entries.length === 0 ? remove(id) : write(id, journal),
        );
        if (Result.isFailure(written)) {
          observability?.note("journal.write", "failed", written.failure.reason, {
            "journal.write": id,
          });
          // Keep it dirty so the next burst tries again; a lost journal is
          // worse than a repeated write.
          unwritten.add(id);
        } else
          observability?.note("journal.write", "rewrote", undefined, {
            "journal.write": id,
            "journal.entries": journal.entries.length,
          });
      }
    });

    // The live bounds. `debounced` re-reads them each pass, so `setPolicy`
    // only has to move the numbers.
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

    /** Synchronous half of `journal`: what a `book.changes` listener may do. */
    const record = (
      book: Book,
      receipt: Receipt,
      changes: readonly Change[],
      projectId: string,
    ): void => {
      const id = idOf(projectId, book.id);
      const existing = journals.get(id);
      const journal = existing ?? {
        header: { v: JOURNAL_VERSION, projectId, bookId: book.id, path: book.path },
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

    /**
     * Every journal id on disk, `<projectId>/<bookId>`; empty when there is no
     * root.
     *
     * At least two segments, not exactly two: a `ProjectId` is a PATH (plus a
     * `#primary` suffix when the folder is a burrito), so a journal for
     * `/sefer/projects/small-nt` lands four directories down and an
     * exactly-two rule listed none of them — which is to say `pending` found
     * nothing on either real host. The id is only a handle; a journal's
     * identity is the header it carries, which is what `pending` reads.
     */
    const listIds = Effect.map(
      Effect.orElseSucceed(fileSystem.readDirectory(root, { recursive: true }), () => []),
      (names) =>
        names
          .filter((name) => name.endsWith(JOURNAL_SUFFIX) && name.split("/").length >= 2)
          .map((name) => name.slice(0, -JOURNAL_SUFFIX.length)),
    );

    const prune = (
      id: string,
      journal: Journal,
      stamp: SourceStamp,
    ): Effect.Effect<void, RecoveryError> => {
      const kept = journal.entries.filter((entry) => entry.after.revision > stamp.revision);
      if (kept.length === journal.entries.length) return Effect.void;
      const compacted: Journal = { header: journal.header, entries: kept };
      journals.set(id, compacted);
      unwritten.delete(id);
      observability?.note("journal.compact", "rewrote", undefined, {
        "journal.write": id,
        "journal.entries": kept.length,
      });
      return kept.length === 0 ? remove(id) : write(id, compacted);
    };

    return {
      journal: (book, receipt, changes, projectId) =>
        Effect.suspend(() => {
          const project = projectId ?? projects.get(book.id);
          // A journal needs a project identity to be findable on the next
          // boot. Guessing one would produce a journal nothing can restore, so
          // the misuse is a defect rather than a quiet no-op.
          if (project === undefined)
            return Effect.die(
              new Error(`recovery.journal: book ${book.id} was never attached to a project`),
            );
          record(book, receipt, changes, project);
          return Effect.void;
        }),

      attach: (book, projectId) =>
        Effect.gen(function* () {
          projects.set(book.id, projectId);
          const unsubscribe = book.changes((receipt, changes) => {
            record(book, receipt, changes, projectId);
          });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              unsubscribe();
              projects.delete(book.id);
            }),
          );
        }),

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
            });
          }
          observability?.note("journal.pending", "ready", undefined, {
            "journal.pending": found.length,
          });
          return found;
        }),

      restore: (id, resolveBook) =>
        Effect.gen(function* () {
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
          journals.set(id, journal);
          observability?.note("journal.restore", "rewrote", undefined, {
            "journal.write": id,
            "journal.entries": journal.entries.length,
            "book.id": book.id,
          });
          return book;
        }),

      discard: (id) =>
        Effect.gen(function* () {
          journals.delete(id);
          unwritten.delete(id);
          yield* remove(id);
          observability?.note("journal.discard", "consumed", undefined, {
            "journal.write": id,
          });
        }),

      setPolicy: (next) =>
        Effect.sync(() => {
          policy = next;
        }),

      compact: (bookId, stamp) =>
        Effect.gen(function* () {
          const known = projects.get(bookId);
          // The book's own journal when we know its project, plus any journal
          // on disk for this book id — a journal restored from a previous boot
          // is not in memory, and leaving it would offer the same work twice.
          const candidates = new Set<string>(known === undefined ? [] : [idOf(known, bookId)]);
          for (const id of yield* listIds) if (id.endsWith(`/${bookId}`)) candidates.add(id);
          for (const id of candidates) {
            const inMemory = journals.get(id);
            if (inMemory !== undefined) {
              yield* prune(id, inMemory, stamp);
              continue;
            }
            const onDisk = yield* Effect.result(read(id));
            if (Result.isSuccess(onDisk)) yield* prune(id, onDisk.success, stamp);
          }
        }),
    };
  });

/**
 * The Recovery layer. The flush fiber lives in the layer's own Scope, so
 * closing the layer stops journalling; entries still in memory at that point
 * are lost by design — a clean shutdown has nothing to recover.
 */
export const RecoveryLive = (
  options: RecoveryOptions,
): Layer.Layer<Recovery, never, FileSystem.FileSystem> => Layer.effect(Recovery, make(options));
