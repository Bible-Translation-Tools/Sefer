/**
 * The incoming plan: what a receive would actually change, in books and
 * chapters, worked out before anything is applied.
 *
 * Pure, like `./state.ts`. It is a VIEW over two things decided elsewhere:
 * each book's change facts (`./facts.ts`, from the engine's diff against the
 * merge base) and the policy's verdict on it (`./policy.ts`). That is what
 * lets "3 chapters of Mark changed on the cloud; 1 of them also changed here"
 * be computed, tested and rendered without a network, and it is why the plan
 * can never disagree with Combine about which books need a person.
 *
 * Nothing here writes, applies or merges.
 */

import type { ChangeKind, Commit } from "../git/git";
import { FRONT_MATTER, type BookFacts } from "./facts";
import { DEFAULT_OVERLAP, judge, type BookVerdict, type Overlap } from "./policy";

export { FRONT_MATTER };

/** One book in the plan, with the chapters named. */
export interface IncomingBook {
  readonly bookId: string;
  readonly path: string;
  readonly kind: ChangeKind;
  /** Chapters the cloud changed, ascending; `FRONT_MATTER` for the header. */
  readonly chapters: readonly number[];
  /** Of those, the ones this device also changed since the same base. */
  readonly alsoHere: readonly number[];
  /** Verses (the engine's units) the cloud changed; 0 when it could not say where. */
  readonly verses: number;
  /** Of those, the ones this device also changed since the same base. */
  readonly versesAlsoHere: number;
  /** True when the policy sends this book to a person: it goes to Compare. */
  readonly contested: boolean;
  readonly verdict: BookVerdict;
}

/**
 * Everything a translator is told before a pull runs.
 *
 * `clean` is the load-bearing field: true means a pull changes nothing this
 * device has also worked on, so applying it is a fast-forward and the
 * narration can promise "nothing you have written will move". False means at
 * least one book is contested, and the primary action stops being Pull.
 */
export interface IncomingPlan {
  /** The cloud's commits this device does not have, newest first. */
  readonly commits: readonly Commit[];
  readonly books: readonly IncomingBook[];
  /** Book ids touched on both sides — never merged, always compared. */
  readonly contested: readonly string[];
  /** Total chapters the cloud changed, across every book. */
  readonly chapterCount: number;
  /** Of those, how many this device also changed. */
  readonly overlapCount: number;
  /** Total verses the cloud changed, across every book. */
  readonly verseCount: number;
  /** Of those, how many this device also changed. */
  readonly verseOverlap: number;
  readonly clean: boolean;
}

/** The empty plan — what "nothing is coming" looks like. */
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

/**
 * The plan for a set of incoming commits and the facts of every book they
 * touched. A view over the facts and the policy's verdicts, never a second
 * computation of either.
 *
 * Books the other side did not change are dropped: a commit that only rewrote
 * a file Sefer does not read has nothing to tell a translator.
 */
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
