import type { BookFacts } from "./facts";

export type Overlap = "project" | "book" | "chapter" | "verse";

export const DEFAULT_OVERLAP: Overlap = "book";

export type BookVerdict = "none" | "keep" | "take" | "combine" | "review";

const intersects = <A>(left: readonly A[], right: readonly A[]): boolean => {
  const set = new Set(left);
  return right.some((item) => set.has(item));
};

const verdictOf = (facts: BookFacts, overlap: Overlap): BookVerdict => {
  const { mine, theirs } = facts;
  if (!theirs.changed) return mine.changed ? "keep" : "none";
  if (!mine.changed) return overlap === "project" ? "review" : "take";
  if (overlap === "project" || overlap === "book") return "review";
  if (!mine.present || !theirs.present || !mine.located || !theirs.located) return "review";
  const overlapping =
    overlap === "chapter"
      ? intersects(mine.chapters, theirs.chapters)
      : intersects(mine.refs, theirs.refs);
  return overlapping ? "review" : "combine";
};

export const judge = (facts: readonly BookFacts[], overlap: Overlap): readonly BookVerdict[] =>
  facts.map((book) => verdictOf(book, overlap));
