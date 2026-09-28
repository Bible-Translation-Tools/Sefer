// compare.ts
//
// The comparison itself: two `CompareSource`s in, one frozen `CompareResult`
// out. Everything here is either an Effect ON the sources or a pure function
// of what they returned; there is no Book, no FileSystem and no host.
//
// What this module owns is the BOOK level: which books each side holds, which
// of them differ, and the texts to decide over. The unit a reader decides on
// inside a book is the engine's decision unit, merged by `mergeWithDecisions`
// in `core/diff/skeleton.ts` and written into the working text by Review as it is decided — see
// `documentation/architecture/review.md`. There is no diff here at all: two
// texts are identical or they are not, and what differs inside a book is the
// engine's to say (the review asks it only for books that differ).
//
// A book present on only one side is its own kind of difference: there is
// nothing to line up.

import { Effect } from "effect";

import type { BookId } from "../book/book";
import type { SourceStamp } from "../source/source";
import { sourceRef, type CompareSource, type CompareError, type SourceRef } from "./source";

/** Which sides hold this book at all. */
export type Presence = "both" | "left" | "right";

/**
 * One book's comparison.
 *
 * `stamp` is the LEFT side's stamp when it has one, and it is what Apply
 * checks before writing: a target that has moved since the comparison was
 * taken is refused, not re-diffed.
 */
export interface BookComparison {
  readonly bookId: BookId;
  readonly presence: Presence;
  readonly leftText: string | undefined;
  readonly rightText: string | undefined;
  readonly leftStamp: SourceStamp | undefined;
  readonly rightStamp: SourceStamp | undefined;
  /** Both sides hold it and the texts are identical. */
  readonly identical: boolean;
}

export interface CompareResult {
  readonly left: SourceRef;
  readonly right: SourceRef;
  /** Every book either side holds: left's order, then right-only books. */
  readonly books: readonly BookComparison[];
  /** Books that differ at all — changed, left-only or right-only. */
  readonly changedBooks: number;
  readonly leftOnly: number;
  readonly rightOnly: number;
}

/**
 * The union of both sides' books, in left's order with right-only books
 * appended in right's. Canonical order is each side's own business —
 * `discoverBooks` already sorts a folder by canon number, and a project keeps
 * the order it opened in — so this preserves rather than re-sorts.
 */
const unionOrder = (left: readonly BookId[], right: readonly BookId[]): readonly BookId[] => {
  const seen = new Set(left);
  return [...left, ...right.filter((bookId) => !seen.has(bookId))];
};

/**
 * Compares every book either side holds.
 *
 * One read per book per side, and the whole thing is finished before anything
 * is rendered: a comparison is a snapshot, and a screen that streamed it would
 * let the counts move while the reader was deciding.
 *
 * A book present on one side only is NOT read from the other — `read` would
 * fail `Absent`, and asking is how a compare between a folder and a project
 * with sixty missing books would turn into sixty failures.
 */
export const compareBooks = (
  left: CompareSource,
  right: CompareSource,
): Effect.Effect<CompareResult, CompareError> =>
  Effect.gen(function* () {
    const leftBooks = yield* left.books();
    const rightBooks = yield* right.books();
    const inRight = new Set(rightBooks);
    const inLeft = new Set(leftBooks);

    const books: BookComparison[] = [];
    for (const bookId of unionOrder(leftBooks, rightBooks)) {
      const onLeft = inLeft.has(bookId);
      const onRight = inRight.has(bookId);
      const leftText = onLeft ? yield* left.read(bookId) : undefined;
      const rightText = onRight ? yield* right.read(bookId) : undefined;

      if (leftText !== undefined && rightText !== undefined) {
        // Identical texts are the common case — most books of a review are
        // untouched — and string equality answers it at memory speed, length
        // first. The engine's diff is asked only for the books that differ.
        books.push({
          bookId,
          presence: "both",
          leftText: leftText.text,
          rightText: rightText.text,
          leftStamp: leftText.stamp,
          rightStamp: rightText.stamp,
          identical: leftText.text === rightText.text,
        });
        continue;
      }

      books.push({
        bookId,
        presence: onLeft ? "left" : "right",
        leftText: leftText?.text,
        rightText: rightText?.text,
        leftStamp: leftText?.stamp,
        rightStamp: rightText?.stamp,
        identical: false,
      });
    }

    return {
      left: sourceRef(left),
      right: sourceRef(right),
      books,
      changedBooks: books.filter((book) => !book.identical).length,
      leftOnly: books.filter((book) => book.presence === "left").length,
      rightOnly: books.filter((book) => book.presence === "right").length,
    } satisfies CompareResult;
  });

/** The book, by id, from a result — the screen's one lookup. */
export const bookComparison = (result: CompareResult, bookId: BookId): BookComparison | undefined =>
  result.books.find((book) => book.bookId === bookId);
