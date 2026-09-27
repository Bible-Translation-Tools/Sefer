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
// engine's edits from the book's current text to the plan's text, one per
// decision unit that differs (`GalleyService.mergeSplices`, handed in as
// `edits` because core/compare holds no engine). One apply is still one
// revision and one Undo step, but the untouched units keep their offsets, so a
// cursor, a finding and a search hit outside what changed survive the write.

import { Effect, Result } from "effect";

import type { BookId } from "../book/book";
import { trustedBy } from "../book/book";
import type { Project } from "../project/project";
import { nameOfRoot } from "../project/slug";
import type { Change } from "../source/source";
import { failCompare, type CompareSource } from "./source";

/**
 * The currently open project as one side of a comparison.
 *
 * `label` defaults to "This project (<folder>)" because on the screen it sits
 * beside a zip's file name and the reader has to tell them apart at a glance.
 */
/**
 * The edits that turn `before` into `after`, in `before`'s UTF-16 offsets,
 * ascending and non-overlapping — a `book.apply` change list. `undefined` when
 * they cannot be had (an engine without the door), which refuses the write.
 */
export type EditsBetween = (before: string, after: string) => readonly Change[] | undefined;

export const currentProjectSource = (
  project: Project,
  options: { readonly label?: string; readonly edits: EditsBetween },
): CompareSource => ({
  id: `project:${project.id}`,
  label: options.label ?? `This project (${nameOfRoot(project.root)})`,
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
    Effect.gen(function* () {
      if (project.book(bookId) === undefined)
        return yield* failCompare(
          "Unsupported",
          `${bookId} is not in this project; Compare cannot add a book yet`,
        );

      // Seat the book first, so the write lands in the editor-backed Book and
      // therefore in its history: "apply what they chose" and "and let me undo
      // it" are the same request. A project with no seat (a headless run) is
      // refused the seat and written plainly, which is still one revision
      // through the one write path — just with nothing to undo it with.
      yield* Effect.orElseSucceed(project.instantiate(bookId), () => undefined);
      const book = project.book(bookId);
      if (book === undefined)
        return yield* failCompare("Absent", `${bookId} left the project mid-apply`);

      const current = book.source();
      if (current.text === text)
        return yield* failCompare("Refused", `${bookId} already holds exactly this text`);

      const changes = options.edits(current.text, text);
      if (changes === undefined)
        return yield* failCompare(
          "Refused",
          `${bookId}: this build's engine cannot say what changed, so nothing was written`,
        );

      const receipt = book.apply(changes, "compare", trustedBy("compare"));
      return Result.isFailure(receipt)
        ? yield* failCompare(
            "Refused",
            `${bookId}: ${receipt.failure.rule} refused (${receipt.failure.reason})`,
          )
        : receipt.success;
    }),
});
