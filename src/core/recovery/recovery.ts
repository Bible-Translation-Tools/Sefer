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
import { joinPath, normalisePath } from "../fileSystem/path";
import { Observability } from "../observability";
import type { Project } from "../project/project";
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
  /** `<projectId>/<book path in the project>` — the journal's identity and its path stem. */
  readonly id: string;
  readonly projectId: string;
  readonly bookId: BookId;
  /** The project file the entries belong to, recorded when the journal opened. */
  readonly path: string;
  /** The `after` stamp of the last entry: the revision the work reached. */
  readonly lastStamp: SourceStamp;
  readonly entries: readonly JournalEntry[];
  /**
   * The journal THIS session is writing — the live backup of what is on
   * screen, never something to offer back. Every other journal is an earlier
   * session's.
   */
  readonly thisSession: boolean;
  /**
   * The engine hash (xxh3) of the text the first entry applies to, and of the
   * text the last flush left — decimal strings, absent in a journal written
   * before hashes were kept. What `pendingOnOpen` and `restore` compare.
   */
  readonly base: string | undefined;
  readonly end: string | undefined;
  /**
   * Set by `pendingOnOpen`: the file no longer holds the text this journal
   * started from, nor the text it reached (changed by another tool, or
   * another machine). Its work cannot be replayed; it can be discarded.
   */
  readonly stale?: boolean;
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
   * Journals every edit to the project's books, from the Project's one
   * canonical edit feed (`Project.edits`): seated or not, whichever surface
   * made it, each edit once. Mounted ONCE per open project; the returned
   * function unmounts it when the project closes.
   *
   * `diskHash` is the engine hash of what the file holds now — Save's
   * baseline, which follows every save. A new journal records it as its
   * `base`; a flush that finds the book's text hashing to it again clears the
   * journal instead of writing it, because there is nothing left unsaved.
   */
  readonly mount: (
    project: Project,
    diskHash: (bookId: BookId) => bigint | undefined,
  ) => () => void;
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
   * Moves an earlier session's journal out of this session's way, under an id
   * of its own, and returns that id.
   *
   * A book's journal lives at one path, and this session's first edit to the
   * book rewrites that path whole. An earlier session's unsaved work left
   * there would be overwritten by the first keystroke — before anybody was
   * asked about it. Set aside at open, it stays until it is restored or
   * discarded. A journal this session is writing, or one already set aside,
   * keeps its id.
   */
  readonly setAside: (id: string) => Effect.Effect<string, RecoveryError>;
  /**
   * What a successful save does to a book's journals: drops the entries it
   * wrote (every `after` revision at or before the saved stamp), records the
   * saved text's `hash` as the journal's new `base`, and clears the earlier
   * sessions' journals set aside for the book. An emptied journal file is
   * removed. Save calls this in step 7 of `save`.
   */
  readonly compact: (
    bookId: BookId,
    stamp: SourceStamp,
    hash?: bigint,
  ) => Effect.Effect<void, RecoveryError>;
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
  /**
   * The trace of the gesture open right now, if any — read when an edit is
   * recorded, so the flush it arms can say which gesture it followed from
   * (`op.cause`). Injected because the answer lives in the editor, which core
   * may not name; omitted, a flush is simply background work with no cause.
   */
  readonly cause?: () => string | undefined;
  /**
   * The engine's content hash (xxh3 of the canonical LF text). Core computes
   * no hash; without it a journal records none and falls back to the stamp
   * checks it was written with.
   */
  readonly hasher?: (text: string) => bigint;
}

export const DEFAULT_JOURNAL_POLICY: DebouncePolicy = { idleMs: 500, maxIntervalMs: 5000 };

const JOURNAL_VERSION = 1;

const JOURNAL_SUFFIX = ".jsonl";

/**
 * The first line of every journal, so a file found on disk is self-describing.
 * `base` and `end` are engine hashes as decimal strings (see `Restorable`),
 * rewritten with the file.
 */
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

/**
 * THE spelling of a journal id: its path under the journal root, normalised,
 * with no leading slash. Every id is made or taken in through this — a
 * journal made in memory (`idOf`), one found on disk (`listIds`), and every id
 * a caller hands back — so one journal has one id.
 *
 * A `ProjectId` is an absolute path and the disk listing is relative to the
 * root. When those were two spellings, the in-memory journal and its file had
 * two ids: Discard removed the file but not the journal, whose next flush
 * wrote every entry back, and a session's own journal was offered back to it
 * as an earlier session's.
 */
const journalId = (path: string): string => normalisePath(path).replace(/^\/+/, "");

/**
 * A book's journal id: the project, and the book's PATH in it. The journal's
 * claim is "these edits apply to this file", and a book id — read from the
 * `\id` line — can disagree with the file it is in.
 */
const idOf = (projectId: string, root: string, path: string): string => {
  const file = normalisePath(path);
  const base = normalisePath(root);
  const inProject = file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
  return journalId(`${projectId}/${inProject}`);
};

/** The live journal a set-aside id was moved from. */
const liveOf = (id: string): string => (isAside(id) ? id.slice(0, id.lastIndexOf(ASIDE)) : id);

/** Marks an id set aside: `<projectId>/<book path>@<last entry's time>`. */
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

    const hasher = options.hasher;
    /** Open journals, by id. */
    const journals = new Map<string, Journal>();
    /**
     * The mounted project's books, by book id: the journal each one's edits
     * go to, the Book that holds its text now, and what the file hashes to.
     * What a flush compares and a save compacts; cleared on unmount.
     */
    const books = new Map<
      BookId,
      { readonly id: string; book: Book; readonly disk: () => bigint | undefined }
    >();
    /** Journals whose in-memory entries the flush has not written yet. */
    const unwritten = new Set<string>();
    /**
     * Journals this session has written, or holds as the file on disk (a
     * restore of a live journal). The FIRST write of any other id moves an
     * earlier session's file at that path aside before it writes — the only
     * place a file is overwritten, so no edit, however early, can overwrite
     * work nobody has been asked about.
     */
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

    /**
     * An earlier session's journal at `id`'s path, moved to `<id>@<its last
     * entry's time>`; nothing to do when there is none. Returns the new id.
     * Written before removed, so a crash between leaves two copies, never none.
     */
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

    // The flush is the only writer. It rewrites each dirty journal whole:
    // `writeFileAtomic` on the complete file is append-by-rewrite, which at
    // journal scale (one book's unsaved edits) is the simplest correct thing —
    // no partial line can ever be read, and there is no append primitive on
    // the `FileSystem` port to be atomic with.
    //
    // One flush is one `journal.write` operation: background work that
    // FOLLOWED the edits that armed it, so it is caused by the last of them
    // rather than parented to any. The per-journal notes are inside it.
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
        // Back to what the file holds — typing undone, a take put back —
        // there is nothing unsaved: the journal is cleared, not written.
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
            // Keep it dirty and write nothing: overwriting the earlier file
            // is the one thing this must not do.
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
          // Keep it dirty so the next burst tries again; a lost journal is
          // worse than a repeated write.
          unwritten.add(id);
        } else {
          entries += journal.entries.length;
          // An empty journal is REMOVED, not written: say which.
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

    /** One edit, into its book's journal: memory only, never the filesystem. */
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
      // What is kept starts at the text just saved: that is its base now.
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
          // The entries are offsets into the text the journal started from:
          // the file as it was read, which is also the file after a save (a
          // save trims the entries it wrote, so the first kept entry starts
          // at the saved text — and at a revision past 0, which is why the
          // revision is NOT compared). So the book must be as it was read —
          // unedited this session — and the length its first entry started
          // at. A book edited since it opened is some other text, and a
          // replay would land every change in the wrong place.
          //
          // With a hash kept, that is one comparison: the book's text now
          // against the text the journal started from. Without one (a journal
          // from before hashes), the stamp: unedited, and the same length.
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
          // The replay went through the Book, so this session's own journal
          // recorded every entry again — IF the book is journalled. Only then
          // has a set-aside journal done its job; otherwise it stays, and is
          // offered again, rather than the only copy being deleted.
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
            // The file on disk IS this journal: the next flush rewrites it
            // rather than moving it aside as an earlier session's.
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
          // THIS project's journal for the book — the mounted project's, by
          // the book's path. A book id alone is `MAT` in every project, and
          // trimming another project's MAT by this one's revision cut work
          // out of it.
          const known = books.get(bookId);
          if (known === undefined) return;
          const live = known.id;
          const inMemory = journals.get(live);
          if (inMemory !== undefined) yield* prune(live, inMemory, stamp, hash);
          else {
            const onDisk = yield* Effect.result(read(live));
            if (Result.isSuccess(onDisk)) yield* prune(live, onDisk.success, stamp, hash);
          }
          // A save is a decision about the book: what is written is the work.
          // Earlier sessions' journals set aside for it are cleared with it,
          // as Discard clears them — never left to be offered again, or to be
          // replayed later onto a text they no longer describe.
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

/**
 * The Recovery layer. The flush fiber lives in the layer's own Scope, so
 * closing the layer stops journalling; entries still in memory at that point
 * are lost by design — a clean shutdown has nothing to recover.
 */
export const RecoveryLive = (
  options: RecoveryOptions,
): Layer.Layer<Recovery, never, FileSystem.FileSystem> => Layer.effect(Recovery, make(options));
