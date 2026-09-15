// pastSources.ts
//
// The reader's OWN PAST as compare sources: the bytes in the file, and the
// text in the last recorded version.
//
// These exist because `/review` is one screen. Save & Review and Compare were
// two screens asking the same question — "these two texts differ; which do I
// keep" — and the only real difference between them was that one had the file
// hard-coded on one side. Once both sides of the review are a `CompareSource`,
// the file on disk and the blob at HEAD are simply two more of them, and the
// screen has no idea which of the five a reader picked.
//
// Two are here rather than one per file because they are the same shape said
// twice: a read-only side whose text comes from somewhere the reader has
// already been. Neither can be written — Sefer does not write into the past —
// so `canApply` is false and the project side is always the target.
//
// ## Freshness: live, and deliberately
//
// `review.md` asks a source to be a SNAPSHOT, so a side cannot move under a
// decision already made. `currentProjectSource` already breaks that on purpose
// (it reads `project.book(id)` on every call, which is what makes a comparison
// of an open book show unsaved keystrokes), and `savedSource` does the same:
// it reads `baselineOf` at `read()` time, so recording a version moves the file
// side immediately rather than leaving the screen describing a file that has
// been overwritten. The screen re-takes the whole comparison when either of
// those moves; a FOLDER, which cannot move, is still scanned once and frozen.
//
// `recordedSource` is frozen by construction: the map is read once per HEAD by
// `src/app/ui/panels/recorded.ts` and rebuilt when a commit moves it.

import { Effect, Option } from "effect";

import type { Book, BookId } from "../book/book";
import type { Project } from "../project/project";
import type { SourceStamp } from "../source/source";
import { failCompare, type CompareSource } from "./source";

/** Just enough of a `Baseline` to be one side: what Save last wrote. */
export interface SavedText {
  readonly text: string;
  readonly stamp: SourceStamp;
}

/**
 * The bytes in the project's files, as one side.
 *
 * `baselineOf` is `SaveCoordinator.baseline`, passed rather than taken as a
 * service so this stays `R = never` like every other source — a side captures
 * what it needs when it is CONSTRUCTED.
 *
 * A book with NO baseline reads as the book's own current text, and that is the
 * save model rather than a shortcut. Save `adopt`s a baseline wherever the
 * shell opens a book, so "no baseline" means nothing in this session has
 * touched the book at all — its text IS the bytes on disk. Reporting such a
 * book as absent would put all sixty-six books of a project somebody merely
 * opened on the "only in the editor" side, which is the exact bug the review's
 * baseline rule exists to prevent (documentation/architecture/review.md).
 */
export const savedSource = (
  project: Project,
  baselineOf: (book: Book) => Option.Option<SavedText>,
  label = "The file on disk",
): CompareSource => ({
  id: `disk:${project.id}`,
  label,
  kind: "disk",
  canApply: false,

  books: () => Effect.sync(() => project.books.map((book) => book.id)),

  read: (bookId) =>
    Effect.suspend(() => {
      const book = project.book(bookId);
      if (book === undefined)
        return failCompare("Absent", `${bookId} is not a book in ${project.root}`);
      const baseline = baselineOf(book);
      if (Option.isSome(baseline))
        return Effect.succeed({ text: baseline.value.text, stamp: baseline.value.stamp });
      const source = book.source();
      return Effect.succeed({ text: source.text, stamp: source.stamp });
    }),
});

/**
 * One book's text in the last recorded version, plus the stamp it decoded to.
 * The shape `recorded.ts` already builds from `git.show`.
 */
export interface RecordedTexts {
  readonly head: string | undefined;
  readonly texts: ReadonlyMap<BookId, SavedText>;
}

/**
 * The blobs at HEAD, as one side.
 *
 * A book HEAD has never seen fails `Absent`, which is the truth and reads on
 * the screen as "only in the editor" — a book about to be recorded for the
 * first time. A project with no repository holds no books at all here, which
 * is also true and is why this side is never the default.
 */
export const recordedSource = (
  recorded: RecordedTexts,
  label = "The last recorded version",
): CompareSource => ({
  id: `recorded:${recorded.head ?? "none"}`,
  label: recorded.head === undefined ? `${label} (nothing recorded yet)` : label,
  kind: "recorded",
  canApply: false,

  books: () => Effect.sync(() => [...recorded.texts.keys()]),

  read: (bookId) =>
    Effect.suspend(() => {
      const held = recorded.texts.get(bookId);
      return held === undefined
        ? failCompare("Absent", `${bookId} is not in the last recorded version`)
        : Effect.succeed({ text: held.text, stamp: held.stamp });
    }),
});
