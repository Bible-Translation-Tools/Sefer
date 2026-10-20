import { makeBook, type Book, type BookId, type Receipt } from "@sefer/text/book";
import type { Change, SourceDecodeError } from "@sefer/text/source";
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

import { openBook } from "../book/open";
import { normalisePath } from "../fileSystem/path";
import { Observability, type ObservabilityService, type Operation } from "../observability";
import type { ProjectMetadata } from "../resources/projectMetadata";
import { discoverBooks, readProjectMetadata } from "./discovery";

export type ProjectId = string;

export interface ExternalChange {
  readonly bookId: BookId;
  readonly path: string;
  readonly kind: "changed" | "removed";
}

class ProjectError extends Data.TaggedError("ProjectError")<{
  readonly reason: "NotADirectory" | "NoBooks" | "Refused";
  readonly description: string;
}> {}

export interface FailedBook {
  readonly path: string;
  readonly error: PlatformError.PlatformError | SourceDecodeError | ProjectError;
}

export interface Seated extends Book {
  readonly attached?: () => number;
  readonly close?: () => void;
}

export type Seat = (book: Book) => Seated;

export interface OpenProjectOptions {
  readonly seat?: Seat;
}

export type ProjectListener = (id: BookId) => void;

export interface ProjectEdit {
  readonly bookId: BookId;
  readonly book: Book;
  readonly receipt: Receipt;
  readonly changes: readonly Change[];
}

export type EditListener = (edit: ProjectEdit) => void;

export interface Project {
  readonly id: ProjectId;
  readonly root: string;
  readonly books: readonly Book[];
  readonly failed: readonly FailedBook[];
  book(id: BookId): Book | undefined;
  metadata(): Option.Option<ProjectMetadata>;
  instantiate(id: BookId): Effect.Effect<Book, ProjectError>;
  release(id: BookId): Effect.Effect<void, ProjectError>;
  changed(fn: ProjectListener): () => void;
  edits(fn: EditListener): () => void;
  externalChanges(): Stream.Stream<ExternalChange>;
  close(): Effect.Effect<void>;
}

const WINDOW = Duration.millis(250);

const BATCH = 256;

const refuse = (
  reason: ProjectError["reason"],
  description: string,
): Effect.Effect<never, ProjectError> => Effect.fail(new ProjectError({ reason, description }));

const describe = (error: FailedBook["error"]): string =>
  error._tag === "PlatformError" ? error.message : error.reason;

interface Entry {
  plain: Book;
  seated: Seated | undefined;
}

const current = (entry: Entry): Book => entry.seated ?? entry.plain;

interface ProjectParts {
  readonly root: string;
  readonly fileSystem: FileSystem.FileSystem;
  readonly metadata: Option.Option<ProjectMetadata>;
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
      return found.id === undefined ? root : `${root}#${found.id}`;
    },
  });

  const byPath = new Map<string, BookId>();
  for (const [bookId, entry] of entries) byPath.set(normalisePath(entry.plain.path), bookId);

  const listeners = new Set<ProjectListener>();
  let closed = false;

  const editListeners = new Set<EditListener>();
  const following = new Map<BookId, () => void>();
  const follow = (bookId: BookId, entry: Entry): void => {
    following.get(bookId)?.();
    following.delete(bookId);
    if (editListeners.size === 0) return;
    const book = current(entry);
    following.set(
      bookId,
      book.changes((receipt, changes) => {
        for (const fn of Array.from(editListeners)) fn({ bookId, book, receipt, changes });
      }),
    );
  };
  const unfollowAll = (): void => {
    for (const stop of following.values()) stop();
    following.clear();
  };

  const publish = (bookId: BookId): void => {
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
        const seated = seat(entry.plain);
        entry.seated = seated;
        follow(bookId, entry);
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
        entry.plain = makeBook(seated.path, seated.source(), observability);
        entry.seated = undefined;
        follow(bookId, entry);
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

    edits: (fn) => {
      const first = editListeners.size === 0;
      editListeners.add(fn);
      if (first) for (const [bookId, entry] of entries) follow(bookId, entry);
      return () => {
        editListeners.delete(fn);
        if (editListeners.size === 0) unfollowAll();
      };
    },

    externalChanges: () =>
      Stream.catchCause(
        Stream.flattenIterable(
          Stream.map(Stream.groupedWithin(fileSystem.watch(root), BATCH, WINDOW), coalesce),
        ),
        (cause) => {
          observability?.note("project.watch", "declined", describeCause(cause));
          return Stream.empty;
        },
      ),

    close: () =>
      Effect.flatMap(Effect.serviceOption(Observability), (provided) =>
        Effect.sync(() => {
          if (closed) return;
          closed = true;
          const into = Option.getOrUndefined(provided) ?? observability;
          let seats = 0;
          for (const entry of entries.values()) {
            if (entry.seated !== undefined) seats += 1;
            entry.seated?.close?.();
          }
          listeners.clear();
          editListeners.clear();
          unfollowAll();
          into?.note("project.close", "consumed", `${order.length} books`, {
            "project.books": order.length,
            "project.seats": seats,
          });
        }),
      ),
  };
};

const describeCause = (cause: unknown): string => String(cause).slice(0, 120);

export const openProject = (
  root: string,
  options: OpenProjectOptions = {},
): Effect.Effect<Project, ProjectError, FileSystem.FileSystem | Scope.Scope> =>
  Effect.flatMap(Effect.serviceOption(Observability), (found) => {
    const observability = Option.getOrUndefined(found);
    if (observability === undefined) return openIn(root, options, undefined);
    // SAFETY: an `Operation` is an `ObservabilityService` with three extra members; `attr` is probed before use.
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

/**
 * How many books are read at once when a project opens.
 *
 * Measured over en_ulb (66 books) in Chrome, five opens each, median of the
 * time between `project.open` starting and the parse beginning:
 *
 *   1 (sequential)  161 ms      4  95 ms
 *   12               75 ms     32  71 ms
 *
 * Most of the win is in by 12 and the curve is flat after it, so this is the
 * knee rather than the floor. Bounded rather than unbounded because 32 buys
 * 4ms over 12, and a whole-Bible project would hold every book's bytes in
 * flight at once to get it.
 */
const OPEN_CONCURRENCY = 12;

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

    const reading = observability?.span("file.read", undefined, {
      "project.books": paths.length,
      "file.concurrency": OPEN_CONCURRENCY,
    });
    const reads = yield* Effect.forEach(paths, (path) => Effect.result(openBook(path)), {
      concurrency: OPEN_CONCURRENCY,
    });
    reading?.();

    for (const [index, path] of paths.entries()) {
      // SAFETY: `forEach` answers one result per input, in input order.
      const opened = reads[index]!;
      if (Result.isFailure(opened)) {
        failed.push({ path, error: opened.failure });
        observability?.note("project.open", "declined", `${path} ${describe(opened.failure)}`);
        continue;
      }
      const book = opened.success;
      if (entries.has(book.id)) {
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
