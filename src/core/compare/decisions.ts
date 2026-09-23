// decisions.ts
//
// The decision map, the plan it projects to, and the one write.
//
// The shape is the proto's and the reason is the proto's: choosing a side
// changes NOTHING but an in-memory map. No text moves while the reader is
// reading. `plan` turns the whole map into the resulting text per book, and
// `applyPlan` is the only function here that writes anything — one apply per
// book, so the reader's Undo takes back one book at a time, which is what a
// reader means by "undo that".
//
// Everything except `applyPlan` is pure, synchronous and total: a screen may
// call `plan` on every click.

import { Effect } from "effect";

import type { BookId, Receipt } from "../book/book";
import { wholeBookHunkId, type BookComparison, type CompareResult, type HunkId } from "./compare";
import { failCompare, type CompareError, type CompareSource, type SourceRef } from "./source";

/** Undecided is a real state, not a missing one: Apply refuses while it lasts. */
type Decision = "left" | "right" | "undecided";

/** Hunk id → decision. Absent reads as `undecided`. */
type Decisions = ReadonlyMap<HunkId, Decision>;

const noDecisions: Decisions = new Map();

const decisionFor = (decisions: Decisions, id: HunkId): Decision =>
  decisions.get(id) ?? "undecided";

/** Every id a book asks a question about: its hunks, or the book itself. */
const decisionIds = (book: BookComparison): readonly HunkId[] =>
  book.presence === "both" ? book.hunks.map((hunk) => hunk.id) : [wholeBookHunkId(book.bookId)];

/** One choice, as a new map — the old one is never mutated. */
const decide = (decisions: Decisions, id: HunkId, decision: Decision): Decisions => {
  const next = new Map(decisions);
  if (decision === "undecided") next.delete(id);
  else next.set(id, decision);
  return next;
};

/** The bulk stamp: a whole book, or a whole comparison, in one click. */
const decideMany = (decisions: Decisions, ids: Iterable<HunkId>, decision: Decision): Decisions => {
  const next = new Map(decisions);
  for (const id of ids) {
    if (decision === "undecided") next.delete(id);
    else next.set(id, decision);
  }
  return next;
};

interface Completeness {
  readonly total: number;
  readonly decided: number;
  readonly undecided: number;
  readonly complete: boolean;
}

const count = (ids: readonly HunkId[], decisions: Decisions): Completeness => {
  const decided = ids.filter((id) => decisionFor(decisions, id) !== "undecided").length;
  return {
    total: ids.length,
    decided,
    undecided: ids.length - decided,
    complete: decided === ids.length,
  };
};

/** "N decided of M", for one book. An identical book asks nothing. */
const bookCompleteness = (book: BookComparison, decisions: Decisions): Completeness =>
  count(book.identical ? [] : decisionIds(book), decisions);

/** "N decided of M", for the whole comparison. */
const completeness = (result: CompareResult, decisions: Decisions): Completeness =>
  count(
    result.books.filter((book) => !book.identical).flatMap((book) => decisionIds(book)),
    decisions,
  );

/** Every id in the comparison, for "Keep all left" / "Take all right". */
const allDecisionIds = (result: CompareResult): readonly HunkId[] =>
  result.books.filter((book) => !book.identical).flatMap((book) => decisionIds(book));

/**
 * What one book's text becomes under these decisions.
 *
 * The walk relies on the one property `core/diff` guarantees: the spans
 * BETWEEN hunks are identical on both sides. So the merge is the left text
 * with the chosen slice substituted at each hunk, in order — the right text
 * never has to be walked, and an all-right map reproduces the right text
 * exactly because every span it contributes came from the right side.
 *
 * An undecided hunk keeps `fallback`, which defaults to the left side and which
 * `plan` sets to the side being WRITTEN. That is the only answer that reads
 * right: "undecided" means nobody has asked for a change, so the target keeps
 * what it holds. A fallback fixed at "left" would silently adopt the left text
 * into a right-hand target — a merge tool quietly changing a document nobody
 * touched, which is the single worst thing this module could do.
 */
const mergedText = (
  book: BookComparison,
  decisions: Decisions,
  fallback: "left" | "right" = "left",
): string | undefined => {
  if (book.presence !== "both") {
    const chosen = decisionFor(decisions, wholeBookHunkId(book.bookId));
    if (chosen === "right") return book.rightText;
    if (chosen === "left") return book.leftText;
    // Undecided: nothing changes, so the side that already holds it wins.
    return fallback === "right" ? book.rightText : book.leftText;
  }

  const left = book.leftText ?? "";
  let at = 0;
  let out = "";
  for (const hunk of book.hunks) {
    out += left.slice(at, hunk.leftFrom);
    const chosen = decisionFor(decisions, hunk.id);
    out += (chosen === "undecided" ? fallback : chosen) === "right" ? hunk.right : hunk.left;
    at = hunk.leftTo;
  }
  return out + left.slice(at);
};

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

const sideText = (book: BookComparison, side: "left" | "right"): string | undefined =>
  side === "left" ? book.leftText : book.rightText;

/**
 * The whole decision map, as what would be written.
 *
 * `target` names the side being written — "left" for the ordinary
 * this-project-on-the-left comparison. Which side is the target does not
 * change the merged text; it changes only what counts as a change.
 */
const plan = (
  result: CompareResult,
  decisions: Decisions,
  target: "left" | "right" = "left",
): Plan => {
  const books: BookPlan[] = [];
  for (const book of result.books) {
    const undecided = bookCompleteness(book, decisions).undecided;
    // The TARGET is the fallback: an undecided difference leaves the side
    // being written exactly as it is, whichever side that is.
    const text = mergedText(book, decisions, target);
    const targetText = sideText(book, target);
    const operation: BookPlan["operation"] =
      text === undefined
        ? targetText === undefined
          ? "keep"
          : "remove"
        : targetText === undefined
          ? "add"
          : text === targetText
            ? "keep"
            : "write";
    books.push({ bookId: book.bookId, operation, text, targetText, undecided });
  }

  const undecided = books.reduce((total, book) => total + book.undecided, 0);
  return {
    target: target === "left" ? result.left : result.right,
    books,
    writes: books.filter((book) => book.operation !== "keep"),
    undecided,
    complete: undecided === 0,
  };
};

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
 *  - `Incomplete` — a hunk is still undecided. Half a decision map is not a
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
