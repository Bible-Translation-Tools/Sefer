// projectSource.ts
//
// The open project, as a compare source. This is the ONLY writable source
// today, and the one the Apply button targets.
//
// Two things make it more than a wrapper:
//
//  - It reads whichever seat currently holds a book — `project.book(id)`
//    returns the plain Book or the editor-backed one, and neither the
//    comparison nor Apply can tell them apart. So a comparison of an OPEN book
//    compares what the reader is looking at, including unsaved keystrokes.
//  - Apply goes through `book.apply(changes, "compare", trustedBy("compare"))`
//    — the one write path (documentation/architecture/source.md). Undo, Save,
//    Recovery and the census all see the write because they all subscribe
//    there, and none of them needs to know Compare exists.
//
// Apply writes the MINIMAL change list rather than one whole-book splice: the
// line diff between the book's current text and the plan's text. One apply is
// still one revision and one Undo step, but the untouched lines keep their
// offsets, so a cursor, a finding and a search hit outside the changed region
// survive the write.

import { Effect, Result } from "effect";

import type { BookId } from "../book/book";
import { trustedBy } from "../book/book";
import { diffTexts } from "../diff/diff";
import type { Project } from "../project/project";
import type { Change } from "../source/source";
import { failCompare, type CompareSource } from "./source";

/** The last path segment, which is what a reader calls a project. */
const folderName = (root: string): string => {
  const trimmed = root.endsWith("/") ? root.slice(0, -1) : root;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
};

/**
 * The currently open project as one side of a comparison.
 *
 * `label` defaults to "This project (<folder>)" because on the screen it sits
 * beside a zip's file name and the reader has to tell them apart at a glance.
 */
export const currentProjectSource = (project: Project, label?: string): CompareSource => ({
  id: `project:${project.id}`,
  label: label ?? `This project (${folderName(project.root)})`,
  kind: "project",
  canApply: true,

  books: () => Effect.sync(() => project.books.map((book) => book.id)),

  read: (bookId) =>
    Effect.suspend(() => {
      const book = project.book(bookId);
      if (book === undefined)
        return failCompare("Absent", `${bookId} is not a book in ${project.root}`);
      const source = book.source();
      return Effect.succeed({ text: source.text, stamp: source.stamp });
    }),

  apply: (bookId: BookId, text: string) =>
    Effect.suspend(() => {
      const book = project.book(bookId);
      if (book === undefined)
        return failCompare(
          "Unsupported",
          `${bookId} is not in this project; Compare cannot add a book yet`,
        );
      const current = book.source();
      if (current.text === text)
        return failCompare("Refused", `${bookId} already holds exactly this text`);

      // `diffTexts(current, next)`: the baseline side is the book's text, so
      // the baseline offsets ARE the before-text coordinates `apply` wants,
      // and the working slice is what should stand there instead.
      const changes: readonly Change[] = diffTexts(current.text, text).map((hunk) => ({
        from: hunk.baselineFrom,
        to: hunk.baselineTo,
        insert: hunk.working,
      }));

      const receipt = book.apply(changes, "compare", trustedBy("compare"));
      return Result.isFailure(receipt)
        ? failCompare(
            "Refused",
            `${bookId}: ${receipt.failure.rule} refused (${receipt.failure.reason})`,
          )
        : Effect.succeed(receipt.success);
    }),
});
