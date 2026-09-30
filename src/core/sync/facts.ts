/**
 * Change facts: what each side did to one book since the merge base.
 *
 * Three texts in — the base, mine, theirs — and, per side, whether it
 * changed the book and where: which chapters, which verses. The places come
 * from the engine's whole-book diff, projected by `history/delta.ts`, so a
 * bridge, a moved verse and an added chapter are addressed the way Review
 * addresses them. Nothing slices a book into chapters and nothing reads a
 * designator.
 *
 * Facts decide nothing. "Both sides changed Mark" is a fact; whether that
 * needs a person is `./policy.ts`. Pure: the engine arrives as a function, so
 * this runs over any three texts with no Git, no network and no UI.
 */
import type { DiffSkeleton } from "../galley/diff";
import { deriveDeltaScope } from "../history/delta";

/**
 * The chapter number the front matter is filed under: the book's `\id`,
 * headers and introduction, before the first `\c`. One list rather than a list
 * and a flag; the screen says "the front matter" where it would say "chapter 0".
 */
export const FRONT_MATTER = 0;

/**
 * The engine's diff for one pair of LF texts, or `undefined` when this build's
 * engine has no diff door. Undefined is not "no change": a side whose texts
 * differ but cannot be located is reported changed, with no places, and
 * policy treats unlocated as overlapping everything.
 */
export type Diff = (before: string, after: string) => DiffSkeleton | undefined;

/** What one side did to the book, measured from the base. */
export interface SideFact {
  /** Whether this side holds the book at all. */
  readonly present: boolean;
  readonly changed: boolean;
  /** False when the texts differ but the engine could not say where. */
  readonly located: boolean;
  /** Chapters touched, ascending; `FRONT_MATTER` for the header. */
  readonly chapters: readonly number[];
  /** The sids of the units touched, as the engine wrote them. */
  readonly refs: readonly string[];
}

export interface BookFacts {
  readonly bookId: string;
  /** Repository-relative, forward slashes. */
  readonly path: string;
  /** Whether the merge base held the book. */
  readonly inBase: boolean;
  readonly mine: SideFact;
  readonly theirs: SideFact;
}

/** One book's three texts, LF. `undefined` means that side has no such file. */
export interface BookTexts {
  readonly bookId: string;
  readonly path: string;
  readonly base: string | undefined;
  readonly mine: string | undefined;
  readonly theirs: string | undefined;
}

const unchanged = (present: boolean): SideFact => ({
  present,
  changed: false,
  located: true,
  chapters: [],
  refs: [],
});

const side = (base: string | undefined, text: string | undefined, diff: Diff): SideFact => {
  const present = text !== undefined;
  if (base === text) return unchanged(present);
  // An added or deleted book is a whole-book change: diffed against nothing,
  // every chapter it holds (or held) is touched.
  const before = base ?? "";
  const after = text ?? "";
  const skeleton = diff(before, after);
  const scope = skeleton === undefined ? undefined : deriveDeltaScope(before, after, skeleton);
  if (scope === undefined || !scope.ok)
    return { present, changed: true, located: false, chapters: [], refs: [] };
  const chapters = new Set<number>();
  const refs = new Set<string>();
  for (const chapter of scope.value.chapters) {
    chapters.add(chapter.kind === "frontMatter" ? FRONT_MATTER : chapter.chapter);
    for (const ref of chapter.refs) refs.add(ref);
  }
  return {
    present,
    changed: true,
    located: true,
    chapters: [...chapters].sort((a, b) => a - b),
    refs: [...refs],
  };
};

/**
 * The facts for one book. Identical texts on a side cost no engine call; a
 * side that changed costs one whole-book diff against the base.
 */
export const bookFacts = (texts: BookTexts, diff: Diff): BookFacts => ({
  bookId: texts.bookId,
  path: texts.path,
  inBase: texts.base !== undefined,
  mine: side(texts.base, texts.mine, diff),
  theirs: side(texts.base, texts.theirs, diff),
});
