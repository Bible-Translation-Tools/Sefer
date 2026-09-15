// compare.ts
//
// The comparison itself: two `CompareSource`s in, one frozen `CompareResult`
// out. Everything here is either an Effect ON the sources or a pure function
// of what they returned; there is no Book, no FileSystem and no host.
//
// The unit of a comparison is a BOOK, and inside a book a HUNK from
// `core/diff`'s line diff. That is the whole model. The proto's model was
// Onion's chapter skeleton with moved units and interleave slots; ours is
// deliberately coarser, because a line hunk is already what a translator
// reads and because a line hunk composes — the equal spans between hunks are
// identical on both sides, so a merged text is a walk with substitutions
// (see `plan` in decisions.ts) rather than a second engine call.
//
// A book present on only one side is its own kind of difference, not a hunk:
// there is nothing to line up. It carries ONE decision for the whole book.

import { Effect } from "effect";

import type { BookId } from "../book/book";
import { diffTexts, type TextHunk } from "../diff/diff";
import type { SourceStamp } from "../source/source";
import { sourceRef, type CompareSource, type CompareError, type SourceRef } from "./source";

/** Stable within one comparison; the key of the decision map. */
export type HunkId = string;

/**
 * One difference inside a book that both sides hold.
 *
 * The two sides are named `left` and `right` rather than diff's
 * `baseline`/`working`, because neither side of a compare is older than the
 * other — that asymmetry belongs to Save's baseline, not here.
 *
 * `leftFrom`/`leftTo` index the left text and `rightFrom`/`rightTo` the right;
 * both are half-open line ranges, so a pure insertion is a zero-width range on
 * the side that lacks it.
 */
export interface CompareHunk {
  readonly id: HunkId;
  readonly bookId: BookId;
  readonly kind: TextHunk["kind"];
  readonly leftFrom: number;
  readonly leftTo: number;
  readonly rightFrom: number;
  readonly rightTo: number;
  readonly left: string;
  readonly right: string;
}

/** Which sides hold this book at all. */
export type Presence = "both" | "left" | "right";

/**
 * One book's comparison.
 *
 * `decisions` is how many choices this book asks for: one per hunk when both
 * sides hold it, and exactly one — the whole book — when only one side does.
 * `stamp` is the LEFT side's stamp when it has one, and it is what Apply
 * checks before writing: a target that has moved since the comparison was
 * taken is refused, not re-diffed.
 */
export interface BookComparison {
  readonly bookId: BookId;
  readonly presence: Presence;
  readonly hunks: readonly CompareHunk[];
  readonly leftText: string | undefined;
  readonly rightText: string | undefined;
  readonly leftStamp: SourceStamp | undefined;
  readonly rightStamp: SourceStamp | undefined;
  readonly decisions: number;
  /** Both sides hold it and the texts are byte-identical. */
  readonly identical: boolean;
}

export interface CompareResult {
  readonly left: SourceRef;
  readonly right: SourceRef;
  /** Every book either side holds: left's order, then right-only books. */
  readonly books: readonly BookComparison[];
  /** Books that differ at all — changed, left-only or right-only. */
  readonly changedBooks: number;
  /** Every decision the reader is being asked for, across every book. */
  readonly decisions: number;
  readonly leftOnly: number;
  readonly rightOnly: number;
}

/** The id of the one decision a one-sided book carries. */
export const wholeBookHunkId = (bookId: BookId): HunkId => `${bookId}:book`;

const hunkId = (bookId: BookId, index: number): HunkId => `${bookId}:${index}`;

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

const toHunks = (bookId: BookId, leftText: string, rightText: string): readonly CompareHunk[] =>
  // `diffTexts(baseline, working)` with left as the baseline: its
  // `baselineFrom/To` index the left text and `from/to` the right.
  diffTexts(leftText, rightText).map((hunk, index) => ({
    id: hunkId(bookId, index),
    bookId,
    kind: hunk.kind,
    leftFrom: hunk.baselineFrom,
    leftTo: hunk.baselineTo,
    rightFrom: hunk.from,
    rightTo: hunk.to,
    left: hunk.baseline,
    right: hunk.working,
  }));

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
        const hunks = toHunks(bookId, leftText.text, rightText.text);
        books.push({
          bookId,
          presence: "both",
          hunks,
          leftText: leftText.text,
          rightText: rightText.text,
          leftStamp: leftText.stamp,
          rightStamp: rightText.stamp,
          decisions: hunks.length,
          identical: hunks.length === 0,
        });
        continue;
      }

      books.push({
        bookId,
        presence: onLeft ? "left" : "right",
        hunks: [],
        leftText: leftText?.text,
        rightText: rightText?.text,
        leftStamp: leftText?.stamp,
        rightStamp: rightText?.stamp,
        // A one-sided book is one question: which side is right about whether
        // this book should exist.
        decisions: 1,
        identical: false,
      });
    }

    return {
      left: sourceRef(left),
      right: sourceRef(right),
      books,
      changedBooks: books.filter((book) => !book.identical).length,
      decisions: books.reduce((total, book) => total + book.decisions, 0),
      leftOnly: books.filter((book) => book.presence === "left").length,
      rightOnly: books.filter((book) => book.presence === "right").length,
    } satisfies CompareResult;
  });

/** The book, by id, from a result — the screen's one lookup. */
export const bookComparison = (result: CompareResult, bookId: BookId): BookComparison | undefined =>
  result.books.find((book) => book.bookId === bookId);
