// project.ts
//
// Project: one folder of books, and the owner of their lifetimes (seams §3.3;
// editor-and-save §1.1 "the four states", §1.5 "Coordinating across many
// books"). Nothing above Project holds Books — it hands out references and
// closes them.
//
// What Project is NOT: it is not a service registry, not a DI container, and
// not a place to hang project-wide features. It knows four things — which
// paths are books, which Book currently seats each one, whether the folder is
// a Scripture Burrito, and what the world outside did to the files.
//
// The four states, and where each transition lives:
//
//   Unloaded      → discovery.ts: paths known, nothing read
//   Plain         → openProject: `openBook` per discovered path
//   Instantiated  → instantiate(id): the editor `seat` takes over as canonical
//   Mounted       → the editor's own business; Project never sees a view
//
// Why a `seat` port rather than an import: core cannot import CodeMirror
// (`pnpm boundaries`), so the editor layer supplies the factory that turns a
// plain Book into an editor-backed one. Project only needs to know that the
// result satisfies `Book` and can say how many views hold it.
//
// Why `changed(fn)` rather than swapping Books in place: instantiating a book
// REPLACES the object that holds its canonical text, and a generic Project
// cannot re-point subscribers that were registered against the old object —
// `book.changes` subscriptions belong to the Book, not to Project. So Project
// keeps one mutable `current` per id and publishes `changed(id)`; readers
// re-resolve through `project.book(id)` and re-subscribe. The alternative — a
// permanent proxy Book that forwards to whichever seat is current — would put
// a hop on the keystroke path, which §1.2 rules out. Holding a Book reference
// across an `instantiate` or `release` is therefore a bug in the holder.

import {
  Data,
  Duration,
  Effect,
  FileSystem,
  Option,
  PlatformError,
  Result,
  Scope,
  Stream,
} from "effect";

import { makeBook, openBook, type Book, type BookId } from "../book/book";
import { normalisePath } from "../fileSystem/path";
import { Observability, type ObservabilityService, type Operation } from "../observability";
import type { BurritoMetadata } from "../resources/burrito";
import type { SourceDecodeError } from "../source/source";
import { discoverBooks, readProjectMetadata } from "./discovery";

/**
 * The project's identity: its root path, and — when the folder is a burrito —
 * the primary id the metadata claims, so two checkouts of the same
 * publication at different paths are still distinguishable from two unrelated
 * folders. Recovery journals are keyed by this, so it must not change between
 * sessions for the same folder.
 */
export type ProjectId = string;

/**
 * What the world outside Sefer did to a book file. `changed` covers creation
 * and modification alike: either way the bytes on disk are no longer the ones
 * we read. Project reports; it NEVER auto-merges — resolving a change is
 * Save's `resolve(change, choice)` (editor-and-save §4.1), which needs the
 * baseline Project does not hold.
 */
export interface ExternalChange {
  readonly bookId: BookId;
  readonly path: string;
  readonly kind: "changed" | "removed";
}

/**
 * `NotADirectory` — the root is not a folder. `NoBooks` — it is, and holds no
 * book files. `Refused` — everything Project itself declined: an unknown book
 * id, a release with views still attached, an instantiate with no seat, a
 * duplicate `\id`, and host failures reading the root (whose `PlatformError`
 * text is carried in the description rather than widening this error).
 */
export class ProjectError extends Data.TaggedError("ProjectError")<{
  readonly reason: "NotADirectory" | "NoBooks" | "Refused";
  readonly description: string;
}> {}

/**
 * A discovered path that did not become a Book. Recorded rather than fatal: a
 * project with one unreadable file is still a project, and the shell can show
 * the failure next to the books that did open.
 *
 * Note on the fixture: `fixtures/small-nt/99-BAD.usfm` is deliberately
 * malformed *USFM*, not malformed *bytes* — valid UTF-8, LF newlines, no BOM —
 * so `Source.decode` accepts it and it opens as an ordinary Book with id
 * `BAD`. Only Galley will have anything to say about it. `failed` is therefore
 * empty for the fixture project; it exists for the real refusals `decode`
 * names (`InvalidUtf8`, `ByteOrderMark`, `MixedNewlines`) and for read errors.
 */
export interface FailedBook {
  readonly path: string;
  readonly error: PlatformError.PlatformError | SourceDecodeError | ProjectError;
}

/**
 * What an editor seat returns: a Book, plus the two lifetime facts a plain
 * Book cannot answer. Both are optional so the editor layer can start with
 * neither and Project still behaves (an absent `attached` reads as zero, so
 * `release` will not be refused).
 */
export interface Seated extends Book {
  /** How many views and windows currently hold this book; blocks `release`. */
  readonly attached?: () => number;
  /** Releases the seat's own resources. Called by `release` and by `close`. */
  readonly close?: () => void;
}

/**
 * The Plain → Instantiated port. The editor layer supplies a factory that
 * builds an editor-backed Book over the plain one's `Source`; core never sees
 * CodeMirror. Called synchronously inside `instantiate`, so a throw here is a
 * defect, not a `ProjectError`.
 */
export type Seat = (book: Book) => Seated;

export interface OpenProjectOptions {
  readonly seat?: Seat;
}

/** Told which book's seat changed; re-resolve through `project.book(id)`. */
export type ProjectListener = (id: BookId) => void;

export interface Project {
  readonly id: ProjectId;
  readonly root: string;
  /** Currently seated Books in canonical order. Re-read after `changed`. */
  readonly books: readonly Book[];
  /** Discovered paths that did not become Books. */
  readonly failed: readonly FailedBook[];
  book(id: BookId): Book | undefined;
  metadata(): Option.Option<BurritoMetadata>;
  /** Plain → Instantiated. Idempotent; `Refused` without a seat. */
  instantiate(id: BookId): Effect.Effect<Book, ProjectError>;
  /** Instantiated → Plain, carrying the seat's current text. */
  release(id: BookId): Effect.Effect<void, ProjectError>;
  /** Synchronous listener set, published after a seat swap. */
  changed(fn: ProjectListener): () => void;
  /** Disk changes to book files. Empty when the host cannot watch. */
  externalChanges(): Stream.Stream<ExternalChange>;
  close(): Effect.Effect<void>;
}

/**
 * Coalescing window for disk events. Editors and sync clients write a file
 * two or three times in quick succession; one report per file per window is
 * what a human means by "the file changed".
 *
 * `Stream.groupedWithin` rather than `Stream.debounce` on purpose: debounce
 * keeps only the newest element in the window, which across a project would
 * report one book and silently drop the others when a Git checkout rewrites
 * several files at once. Grouping keeps the last event *per path*.
 */
const WINDOW = Duration.millis(250);

/** Cap on a single window's batch, so a mass rewrite reports promptly. */
const BATCH = 256;

const refuse = (
  reason: ProjectError["reason"],
  description: string,
): Effect.Effect<never, ProjectError> => Effect.fail(new ProjectError({ reason, description }));

const describe = (error: FailedBook["error"]): string =>
  error._tag === "PlatformError" ? error.message : error.reason;

/**
 * The burrito's primary id, when it declares one: the first
 * `identification.primary[authority][id]` key. Burritos in practice carry one
 * authority and one id; taking the first is the simple reading, and the
 * fallback is the root path alone.
 */
const primaryId = (metadata: BurritoMetadata): string | undefined => {
  for (const ids of Object.values(metadata.identification.primary ?? {}))
    for (const id of Object.keys(ids)) return id;
  return undefined;
};

/** One book's seat: the plain Book, and the editor-backed one when seated. */
interface Entry {
  plain: Book;
  seated: Seated | undefined;
}

const current = (entry: Entry): Book => entry.seated ?? entry.plain;

interface ProjectParts {
  readonly root: string;
  readonly fileSystem: FileSystem.FileSystem;
  readonly metadata: Option.Option<BurritoMetadata>;
  readonly order: readonly BookId[];
  readonly entries: ReadonlyMap<BookId, Entry>;
  readonly failed: readonly FailedBook[];
  readonly seat: Seat | undefined;
  readonly observability: ObservabilityService | undefined;
}

const makeProject = (parts: ProjectParts): Project => {
  const { root, fileSystem, metadata, order, entries, failed, seat, observability } = parts;

  const id: ProjectId = Option.match(metadata, {
    onNone: () => root,
    onSome: (found) => {
      const primary = primaryId(found);
      return primary === undefined ? root : `${root}#${primary}`;
    },
  });

  // Path → book id, fixed at open. `release` rebuilds the plain Book but never
  // its path, so this stays correct for the project's lifetime. A book file
  // created after open is not in it and is therefore not reported: discovery
  // is a snapshot, and a new file needs a re-open, not a merge.
  const byPath = new Map<string, BookId>();
  for (const [bookId, entry] of entries) byPath.set(normalisePath(entry.plain.path), bookId);

  const listeners = new Set<ProjectListener>();
  let closed = false;

  const publish = (bookId: BookId): void => {
    // Snapshot first so a listener may unsubscribe itself, matching
    // `makeListeners` in book.ts.
    for (const fn of Array.from(listeners)) fn(bookId);
  };

  const coalesce = (events: readonly FileSystem.WatchEvent[]): readonly ExternalChange[] => {
    const latest = new Map<string, ExternalChange>();
    for (const event of events) {
      const path = normalisePath(event.path);
      const bookId = byPath.get(path);
      if (bookId === undefined) continue;
      latest.set(path, { bookId, path, kind: event._tag === "Remove" ? "removed" : "changed" });
    }
    return [...latest.values()];
  };

  return {
    id,
    root,
    get books() {
      const books: Book[] = [];
      for (const bookId of order) {
        const entry = entries.get(bookId);
        if (entry !== undefined) books.push(current(entry));
      }
      return books;
    },
    failed,
    book: (bookId) => {
      const entry = entries.get(bookId);
      return entry === undefined ? undefined : current(entry);
    },
    metadata: () => metadata,

    instantiate: (bookId) =>
      Effect.suspend(() => {
        if (closed) return refuse("Refused", `${root} is closed`);
        const entry = entries.get(bookId);
        if (entry === undefined) return refuse("Refused", `${bookId} is not a book in ${root}`);
        if (entry.seated !== undefined) return Effect.succeed<Book>(entry.seated);
        if (seat === undefined)
          return refuse("Refused", `no editor seat was supplied for ${bookId}`);
        // The seat takes the plain Book, not its Source, so it can read the
        // stamp the text arrived with: the invariant is one canonical text,
        // and from here the seat holds it.
        const seated = seat(entry.plain);
        entry.seated = seated;
        observability?.note("seat.open", "ready", undefined, { "book.id": bookId });
        publish(bookId);
        return Effect.succeed<Book>(seated);
      }),

    release: (bookId) =>
      Effect.suspend(() => {
        const entry = entries.get(bookId);
        if (entry === undefined) return refuse("Refused", `${bookId} is not a book in ${root}`);
        const seated = entry.seated;
        if (seated === undefined) return Effect.void;
        const attached = seated.attached?.() ?? 0;
        if (attached > 0) {
          observability?.note("seat.close", "refused", "still attached", {
            "book.id": bookId,
            "book.attached": attached,
          });
          return refuse("Refused", `${bookId} still has ${attached} attached view(s)`);
        }
        // Carry the seat's CURRENT text back to the plain Book: releasing a
        // seat must not lose edits that were accepted but not yet saved.
        entry.plain = makeBook(seated.path, seated.source(), observability);
        entry.seated = undefined;
        seated.close?.();
        observability?.note("seat.close", "ready", undefined, { "book.id": bookId });
        publish(bookId);
        return Effect.void;
      }),

    changed: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    externalChanges: () =>
      Stream.catchCause(
        Stream.flattenIterable(
          Stream.map(Stream.groupedWithin(fileSystem.watch(root), BATCH, WINDOW), coalesce),
        ),
        (cause) => {
          // The memory and OPFS layers do not implement `watch` today, and a
          // host may lose the watch later. Either way the project keeps
          // working with no external-change reporting rather than failing the
          // stream into whoever is rendering it.
          observability?.note("project.watch", "declined", describeCause(cause));
          return Stream.empty;
        },
      ),

    close: () =>
      Effect.sync(() => {
        if (closed) return;
        closed = true;
        // The lifetime hook the seams reserve as `close(book)`: the plain Book
        // holds no resources today, so only a seat has anything to release.
        for (const entry of entries.values()) entry.seated?.close?.();
        listeners.clear();
        observability?.note("project.close", "consumed", `${order.length} books`);
      }),
  };
};

/**
 * Bounded, message-free-ish description of why a watch stopped. The cause's
 * own text is the host's, so it is truncated: telemetry carries codes and
 * counts, never unbounded text (observability caps at 512 either way).
 */
const describeCause = (cause: unknown): string => String(cause).slice(0, 120);

/**
 * Opens every discovered book in `root` as a plain Book: the Unloaded → Plain
 * transition for the whole folder.
 *
 * A path that cannot be read or decoded is recorded in `project.failed` and
 * the project still opens — one bad file must not cost the translator the
 * other sixty-five. Only two things fail the open: a root that is not a
 * directory, and a directory with no book files at all.
 *
 * Requires `Scope`: the scope owns the project's lifetime and closes it, which
 * is also what interrupts any watch fibers a caller started from
 * `externalChanges()` in the same scope. Takes `Observability` optionally, via
 * `serviceOption`, so core policy runs with or without the ring.
 */
export const openProject = (
  root: string,
  options: OpenProjectOptions = {},
): Effect.Effect<Project, ProjectError, FileSystem.FileSystem | Scope.Scope> =>
  Effect.flatMap(Effect.serviceOption(Observability), (found) => {
    const observability = Option.getOrUndefined(found);
    if (observability === undefined) return openIn(root, options, undefined);
    // Opening a project is one end-to-end piece of work, and everything it
    // does — reading metadata, opening each book, adopting baselines, the
    // first analysis pass — belongs inside it rather than beside it. The
    // operation IS an ObservabilityService, so `openIn` narrates into it
    // without knowing it is doing so.
    //
    // Unless we are ALREADY inside one, which is the ordinary case: the shell
    // opens `project.open` as the reader's gesture and provides it here, so
    // that opening the files and analysing them are one record rather than two
    // whose durations have to be added up by hand. Opening a second operation
    // of the same name defeated exactly that, and the ring showed the damage —
    // two overlapping `project.open` records per landing, both claiming 66
    // books, which reads as the project having been opened twice. It was not;
    // it was recorded twice.
    //
    // So: contribute to the one we were handed, and open our own only when
    // nobody handed us anything. That is the rule the event inventory already
    // states for `seat.open` — nested when inside, its own operation when not
    // — and the DI model gives it for free, because whichever service arrives
    // is the one that decides.
    // SAFETY: an `Operation` is an `ObservabilityService` with these three
    // extra members; `attr` is the one probed for and the one used.
    const enclosing = observability as Partial<Operation>;
    if (typeof enclosing.attr === "function") {
      const attr = enclosing.attr.bind(enclosing);
      return Effect.onExit(openIn(root, options, observability), (exit) =>
        Effect.sync(() => {
          if (exit._tag === "Success") attr({ "project.books": exit.value.books.length });
        }),
      );
    }
    const opening = observability.operation("project.open", { "project.root": root });
    return Effect.onExit(openIn(root, options, opening), (exit) =>
      Effect.sync(() => {
        if (exit._tag === "Success")
          opening.end("ready", { "project.books": exit.value.books.length });
        else opening.end("failed");
      }),
    );
  });

const openIn = (
  root: string,
  options: OpenProjectOptions,
  observability: ObservabilityService | undefined,
): Effect.Effect<Project, ProjectError, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    const info = yield* Effect.mapError(
      fileSystem.stat(root),
      (error) => new ProjectError({ reason: "NotADirectory", description: error.message }),
    );
    if (info.type !== "Directory")
      return yield* refuse("NotADirectory", `${root} is a ${info.type}, not a directory`);

    const read = yield* readProjectMetadata(fileSystem, root);
    if (read.declined !== undefined)
      observability?.note("project.metadata", "declined", read.declined);

    const paths = yield* Effect.mapError(
      discoverBooks(fileSystem, root),
      (error) => new ProjectError({ reason: "Refused", description: error.message }),
    );
    if (paths.length === 0) return yield* refuse("NoBooks", `${root} holds no book files`);

    const order: BookId[] = [];
    const entries = new Map<BookId, Entry>();
    const failed: FailedBook[] = [];

    for (const path of paths) {
      const opened = yield* Effect.result(openBook(path));
      if (Result.isFailure(opened)) {
        failed.push({ path, error: opened.failure });
        observability?.note("project.open", "declined", `${path} ${describe(opened.failure)}`);
        continue;
      }
      const book = opened.success;
      if (entries.has(book.id)) {
        // Two files claiming one `\id` would make `book(id)` ambiguous, and
        // every reader addresses books by id. The first in canonical order
        // keeps the id; the second is reported, not silently shadowed.
        const error = new ProjectError({
          reason: "Refused",
          description: `${path} repeats the book id ${book.id}`,
        });
        failed.push({ path, error });
        observability?.note("project.open", "refused", `${path} duplicate ${book.id}`);
        continue;
      }
      entries.set(book.id, { plain: book, seated: undefined });
      order.push(book.id);
    }

    const project = makeProject({
      root,
      fileSystem,
      metadata: read.metadata,
      order,
      entries,
      failed,
      seat: options.seat,
      observability,
    });

    yield* Effect.addFinalizer(() => project.close());
    return project;
  });
