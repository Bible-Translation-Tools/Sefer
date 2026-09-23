/**
 * The incoming plan: what a pull would actually change, in books and chapters,
 * worked out before anything is applied.
 *
 * Pure, like `./state.ts`. The shell reads the blobs (it has `Git.show` and
 * `Git.changedPathsBetween`) and hands them in as text; everything below is
 * arithmetic over USFM. That is what lets the sentence "3 chapters of Mark
 * changed on the cloud; 1 of them also changed here" be computed, tested and
 * rendered without a network.
 *
 * The plan exists for one reason: scripture text is never merged
 * automatically. A pull that can only fast-forward is safe and is described
 * anyway; anything the two sides both touched is named as CONTESTED and sent
 * to Compare, where a person decides. Nothing here writes, applies or merges.
 */

import type { ChangeKind, Commit } from "../git/git";

/**
 * The chapter number the front matter is filed under.
 *
 * A book's `\id`, `\h`, `\toc*` and introduction sit before the first `\c`, and
 * they change — a header gets corrected, a table of contents entry is added.
 * Filing them as chapter zero keeps one list rather than a list and a flag, and
 * the UI says "the front matter" where it would otherwise say "chapter 0".
 */
export const FRONT_MATTER = 0;

const CHAPTER_MARKER = /^\\c[ \t]+(\d+)/gmu;

/**
 * A book's text split at its chapter markers: chapter number → its whole slice,
 * marker line included. Everything before the first `\c` is `FRONT_MATTER`.
 *
 * A textual split rather than an engine parse because this runs over BLOBS —
 * two revisions of a file that may not be open, may not be a book Sefer
 * instantiated, and may not even parse. `\c` at the start of a line is the one
 * thing USFM guarantees about where a chapter begins, and a wrong answer here
 * costs a slightly coarse sentence, never a wrong edit.
 */
const chapterSlices = (text: string): ReadonlyMap<number, string> => {
  const slices = new Map<number, string>();
  const starts: { readonly number: number; readonly at: number }[] = [];
  CHAPTER_MARKER.lastIndex = 0;
  for (let match = CHAPTER_MARKER.exec(text); match !== null; match = CHAPTER_MARKER.exec(text)) {
    starts.push({ number: Number(match[1]), at: match.index });
  }
  const first = starts[0]?.at ?? text.length;
  if (first > 0) slices.set(FRONT_MATTER, text.slice(0, first));
  starts.forEach((start, index) => {
    const end = starts[index + 1]?.at ?? text.length;
    // A duplicated `\c 3` is a broken book, not a reason to lose one of them:
    // the slices are concatenated so the comparison still sees all the text.
    const existing = slices.get(start.number);
    const slice = text.slice(start.at, end);
    slices.set(start.number, existing === undefined ? slice : existing + slice);
  });
  return slices;
};

/**
 * Which chapters differ between two revisions of one book, ascending.
 *
 * A chapter present on one side only counts as changed — that is an added or
 * deleted chapter, and it is exactly the kind of thing a plan must mention.
 */
const chaptersChanged = (before: string, after: string): readonly number[] => {
  if (before === after) return [];
  const left = chapterSlices(before);
  const right = chapterSlices(after);
  const numbers = new Set<number>([...left.keys(), ...right.keys()]);
  return [...numbers]
    .filter((number) => left.get(number) !== right.get(number))
    .sort((a, b) => a - b);
};

/**
 * One file the cloud changed, as the shell reads it out of the object
 * database: the three texts a three-way question needs.
 *
 * `base` is the merge base — the last version both sides shared — and it is
 * what makes "also changed here" answerable at all. With no common ancestor
 * (a repository attached to an unrelated history) the caller passes `""`, and
 * everything reads as changed on both sides, which is the safe answer.
 */
export interface IncomingFile {
  /** Repository-relative, forward slashes. */
  readonly path: string;
  /** The book this file holds, as `identifyBook` or the file stem answers it. */
  readonly bookId: string;
  readonly kind: ChangeKind;
  /** The text at the merge base. */
  readonly base: string;
  /** The text on the cloud. */
  readonly cloud: string;
  /** The text in this work tree right now. */
  readonly here: string;
}

/** One book in the plan, with the chapters named. */
export interface IncomingBook {
  readonly bookId: string;
  readonly path: string;
  readonly kind: ChangeKind;
  /** Chapters the cloud changed, ascending; `FRONT_MATTER` for the header. */
  readonly chapters: readonly number[];
  /** Of those, the ones this device also changed since the same base. */
  readonly alsoHere: readonly number[];
  /** True when the two sides both touched this book: it goes to Compare. */
  readonly contested: boolean;
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
  readonly clean: boolean;
}

/** The empty plan — what "nothing is coming" looks like. */
export const emptyPlan: IncomingPlan = {
  commits: [],
  books: [],
  contested: [],
  chapterCount: 0,
  overlapCount: 0,
  clean: true,
};

const bookOf = (file: IncomingFile): IncomingBook => {
  const chapters = chaptersChanged(file.base, file.cloud);
  const mine = new Set(chaptersChanged(file.base, file.here));
  const alsoHere = chapters.filter((chapter) => mine.has(chapter));
  // Contested is per BOOK, not per chapter. Two people editing different
  // chapters of Mark still produce one file whose two versions must be
  // reconciled, and pretending chapter granularity makes it safe is how a
  // verse goes missing.
  return {
    bookId: file.bookId,
    path: file.path,
    kind: file.kind,
    chapters,
    alsoHere,
    contested: chapters.length > 0 && mine.size > 0,
  };
};

/**
 * The plan for a set of incoming commits and the files they touched.
 *
 * Files the cloud did not actually change (identical base and cloud text) are
 * dropped: a commit that only rewrote a file Sefer does not read has nothing
 * to tell a translator, and listing it as "changed" would be noise.
 */
export const incomingPlan = (
  commits: readonly Commit[],
  files: readonly IncomingFile[],
): IncomingPlan => {
  const books = files
    .map(bookOf)
    .filter((book) => book.chapters.length > 0)
    .sort((a, b) => a.bookId.localeCompare(b.bookId));
  const chapterCount = books.reduce((total, book) => total + book.chapters.length, 0);
  const overlapCount = books.reduce((total, book) => total + book.alsoHere.length, 0);
  const contested = books.filter((book) => book.contested).map((book) => book.bookId);
  return {
    commits,
    books,
    contested,
    chapterCount,
    overlapCount,
    clean: contested.length === 0,
  };
};

/**
 * What a combine would do, when both sides have work.
 *
 * The move is v1's and it is the only one Sefer offers for a divergence: take
 * the cloud's versions as the base, then replay this device's work as ONE
 * version on top. It rewrites no cloud history, produces no merge commit, and
 * leaves a timeline a translator can read — "the cloud's three versions, then
 * mine".
 *
 * It is offered only when `safe`. A contested book means the same file moved
 * on both sides, and replaying over it would either conflict or silently pick
 * a winner; both are worse than the Compare screen.
 */
export interface CombinePlan {
  /** Versions on this device that would become one. */
  readonly mine: number;
  /** Versions from the cloud they would sit on top of. */
  readonly cloud: number;
  /** Books that must be compared by a person first. */
  readonly contested: readonly string[];
  readonly safe: boolean;
}

export const combinePlan = (ahead: number, behind: number, plan: IncomingPlan): CombinePlan => ({
  mine: ahead,
  cloud: behind,
  contested: plan.contested,
  safe: plan.contested.length === 0 && ahead > 0 && behind > 0,
});
