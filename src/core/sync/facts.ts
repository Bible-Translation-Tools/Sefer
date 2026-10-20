import type { DiffSkeleton } from "../galley/diff";
import { deriveDeltaScope } from "../history/delta";

export const FRONT_MATTER = 0;

export type Diff = (before: string, after: string) => DiffSkeleton | undefined;

export interface SideFact {
  readonly present: boolean;
  readonly changed: boolean;
  readonly located: boolean;
  readonly chapters: readonly number[];
  readonly refs: readonly string[];
}

export interface BookFacts {
  readonly bookId: string;
  readonly path: string;
  readonly inBase: boolean;
  readonly mine: SideFact;
  readonly theirs: SideFact;
}

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

export const bookFacts = (texts: BookTexts, diff: Diff): BookFacts => ({
  bookId: texts.bookId,
  path: texts.path,
  inBase: texts.base !== undefined,
  mine: side(texts.base, texts.mine, diff),
  theirs: side(texts.base, texts.theirs, diff),
});
