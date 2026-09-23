// decisions.ts
//
// The plan a review's decisions project to, and the one write.
//
// Choosing a side changes NOTHING but an in-memory map, and that map lives
// with the screen (`ReviewPanel`, over the engine's decision units). What
// lives here is the other end: `Plan` is the resulting text per book, and
// `applyPlan` is the only function that writes anything — one apply per book,
// so the reader's Undo takes back one book at a time, which is what a reader
// means by "undo that".

import { Effect } from "effect";

import type { BookId, Receipt } from "../book/book";
import { failCompare, type CompareError, type CompareSource, type SourceRef } from "./source";

/** What Apply would do to one book. */
export interface BookPlan {
  readonly bookId: BookId;
  /**
   * `keep` — the target already holds this result. `write` — replace its text.
   * `add` / `remove` — the target does not hold this book and should, or holds
   * it and should not. Both are refused today; see `applyPlan`.
   */
  readonly operation: "keep" | "write" | "add" | "remove";
  /** The resulting text, when there is one. */
  readonly text: string | undefined;
  /** What the target held when the comparison was taken — the freshness key. */
  readonly targetText: string | undefined;
  readonly undecided: number;
}

export interface Plan {
  readonly target: SourceRef;
  readonly books: readonly BookPlan[];
  /** The books Apply would actually touch, in order. */
  readonly writes: readonly BookPlan[];
  readonly undecided: number;
  readonly complete: boolean;
}

export interface ApplyReport {
  readonly written: readonly BookId[];
  readonly receipts: readonly Receipt[];
  /** Books the plan touched nothing in — reported so the screen can say so. */
  readonly unchanged: number;
}

/**
 * Writes the plan into the target source.
 *
 * What it refuses, and why each refusal is a refusal rather than a repair:
 *
 *  - `ReadOnly` — the target cannot be written. A folder is a snapshot, not a
 *    working copy; Sefer does not write into the zip somebody shared.
 *  - `Incomplete` — a unit is still undecided. Half a decision map is not a
 *    text anybody asked for.
 *  - `Unsupported` — the plan would add or remove a whole book. A project's
 *    book set is fixed when it opens (`discoverBooks` is a snapshot), so
 *    creating a file would produce a book nothing can reach until the project
 *    is reopened. Refusing by name beats a write the reader cannot see.
 *  - `Stale` — the target moved after the comparison was taken. Its offsets
 *    and its text describe something else now, and re-diffing silently is how
 *    a merge tool loses somebody's paragraph.
 *
 * The checks all run BEFORE the first write, so a plan that is going to be
 * refused writes nothing at all. The writes themselves are sequential and one
 * per book: one apply, one revision, one Undo step each.
 */
export interface ApplyOptions {
  /**
   * Let an undecided difference stand, instead of refusing `Incomplete`.
   *
   * Off by default, which is the contract a comparison between two people's
   * work needs: half a decision map is not a text anybody asked for, and the
   * reader has to say something about every difference before Sefer writes.
   *
   * On for a review against the reader's OWN past — the file on disk, the last
   * recorded version — where "undecided" is not an unanswered question but the
   * ordinary state of the ninety-nine units they are content with. Reverting
   * one verse would otherwise mean deciding every other verse in the book
   * first, which is not what Revert has ever meant. `plan` already makes this
   * safe: an undecided difference keeps the TARGET's own text, so a plan full
   * of them is a plan that writes nothing.
   */
  readonly allowUndecided?: boolean;
}

export const applyPlan = (
  plan_: Plan,
  target: CompareSource,
  options: ApplyOptions = {},
): Effect.Effect<ApplyReport, CompareError> =>
  Effect.gen(function* () {
    const write = target.apply;
    if (!target.canApply || write === undefined)
      return yield* failCompare("ReadOnly", `${target.label} cannot be written`);
    if (!plan_.complete && options.allowUndecided !== true)
      return yield* failCompare("Incomplete", `${plan_.undecided} change(s) are still undecided`);

    for (const book of plan_.writes) {
      if (book.operation !== "write")
        return yield* failCompare(
          "Unsupported",
          book.operation === "add"
            ? `${book.bookId} is not in ${target.label}; Compare cannot add a book yet`
            : `${book.bookId} would be removed from ${target.label}; Compare cannot remove a book yet`,
        );
      const current = yield* target.read(book.bookId);
      if (current.text !== book.targetText)
        return yield* failCompare("Stale", `${book.bookId} changed after the comparison was taken`);
    }

    const written: BookId[] = [];
    const receipts: Receipt[] = [];
    for (const book of plan_.writes) {
      if (book.text === undefined) continue;
      receipts.push(yield* write(book.bookId, book.text));
      written.push(book.bookId);
    }

    return {
      written,
      receipts,
      unchanged: plan_.books.length - written.length,
    } satisfies ApplyReport;
  });
