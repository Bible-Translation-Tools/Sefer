/**
 * The policy: from change facts to what happens to each book.
 *
 * This is the one place overlap is decided. The state machine's `contested`,
 * the incoming plan, Combine and "Skip review of incoming changes" all read
 * `judge`'s answer and none of them works overlap out for itself, so the
 * screen can never offer a move the program then refuses.
 *
 * Scripture text is never merged automatically, and the default holds that
 * line at the BOOK: a book both sides changed goes to a person, whatever
 * chapters each touched. Two people editing different chapters of Mark still
 * produce one file whose two versions someone must reconcile. The finer
 * scopes exist so a team can choose otherwise; they are not the default.
 */
import type { BookFacts } from "./facts";

/**
 * How close two sides' changes must be to count as overlapping.
 *
 * - `project` — any incoming change needs a person: the most cautious.
 * - `book` — a book both sides changed needs a person (the default).
 * - `chapter` — only a chapter both sides changed does.
 * - `verse` — only a verse both sides changed does.
 */
export type Overlap = "project" | "book" | "chapter" | "verse";

export const DEFAULT_OVERLAP: Overlap = "book";

/**
 * What happens to one book on receive.
 *
 * - `none` — neither side changed it.
 * - `keep` — only this side changed it: nothing arrives, mine stays.
 * - `take` — only the other side changed it: theirs arrives as it is.
 * - `combine` — both changed it, in places that do not overlap at the scope.
 *   Reachable only below `book`; putting both sides' units into one text is
 *   a decision commit, never git's merge.
 * - `review` — both changed it and they overlap, or where one side changed it
 *   is not known: a person decides.
 */
export type BookVerdict = "none" | "keep" | "take" | "combine" | "review";

const intersects = <A>(left: readonly A[], right: readonly A[]): boolean => {
  const set = new Set(left);
  return right.some((item) => set.has(item));
};

const verdictOf = (facts: BookFacts, overlap: Overlap): BookVerdict => {
  const { mine, theirs } = facts;
  if (!theirs.changed) return mine.changed ? "keep" : "none";
  if (!mine.changed) return overlap === "project" ? "review" : "take";
  // Both changed from here on. A book one side deleted and the other edited
  // has no place both texts share, and an unlocated change could be anywhere:
  // neither can be combined by address.
  if (overlap === "project" || overlap === "book") return "review";
  if (!mine.present || !theirs.present || !mine.located || !theirs.located) return "review";
  const overlapping =
    overlap === "chapter"
      ? intersects(mine.chapters, theirs.chapters)
      : intersects(mine.refs, theirs.refs);
  return overlapping ? "review" : "combine";
};

/** One verdict per book, in the order the facts were given. */
export const judge = (facts: readonly BookFacts[], overlap: Overlap): readonly BookVerdict[] =>
  facts.map((book) => verdictOf(book, overlap));
