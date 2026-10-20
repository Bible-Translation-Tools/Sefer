import type { ChangeKind, Commit } from "../git/git";
import { FRONT_MATTER, type BookFacts } from "./facts";
import { DEFAULT_OVERLAP, judge, type BookVerdict, type Overlap } from "./policy";

export { FRONT_MATTER };

export interface IncomingBook {
  readonly bookId: string;
  readonly path: string;
  readonly kind: ChangeKind;
  readonly chapters: readonly number[];
  readonly alsoHere: readonly number[];
  readonly verses: number;
  readonly versesAlsoHere: number;
  readonly contested: boolean;
  readonly verdict: BookVerdict;
}

export interface IncomingPlan {
  readonly commits: readonly Commit[];
  readonly books: readonly IncomingBook[];
  readonly contested: readonly string[];
  readonly chapterCount: number;
  readonly overlapCount: number;
  readonly verseCount: number;
  readonly verseOverlap: number;
  readonly clean: boolean;
}

export const emptyPlan: IncomingPlan = {
  commits: [],
  books: [],
  contested: [],
  chapterCount: 0,
  overlapCount: 0,
  verseCount: 0,
  verseOverlap: 0,
  clean: true,
};

const kindOf = (facts: BookFacts): ChangeKind =>
  !facts.theirs.present ? "deleted" : facts.inBase ? "modified" : "added";

export const incomingPlan = (
  commits: readonly Commit[],
  facts: readonly BookFacts[],
  overlap: Overlap = DEFAULT_OVERLAP,
): IncomingPlan => {
  const verdicts = judge(facts, overlap);
  const books = facts
    .map((book, index): IncomingBook => {
      const mine = new Set(book.mine.chapters);
      const mineRefs = new Set(book.mine.refs);
      const verdict = verdicts[index] ?? "review";
      return {
        bookId: book.bookId,
        path: book.path,
        kind: kindOf(book),
        chapters: book.theirs.chapters,
        alsoHere: book.theirs.chapters.filter((chapter) => mine.has(chapter)),
        verses: book.theirs.refs.length,
        versesAlsoHere: book.theirs.refs.filter((ref) => mineRefs.has(ref)).length,
        contested: verdict === "review",
        verdict,
      };
    })
    .filter((_, index) => facts[index]?.theirs.changed === true)
    .sort((a, b) => a.bookId.localeCompare(b.bookId));
  const chapterCount = books.reduce((total, book) => total + book.chapters.length, 0);
  const overlapCount = books.reduce((total, book) => total + book.alsoHere.length, 0);
  const verseCount = books.reduce((total, book) => total + book.verses, 0);
  const verseOverlap = books.reduce((total, book) => total + book.versesAlsoHere, 0);
  const contested = books.filter((book) => book.contested).map((book) => book.bookId);
  return {
    commits,
    books,
    contested,
    chapterCount,
    overlapCount,
    verseCount,
    verseOverlap,
    clean: contested.length === 0,
  };
};
