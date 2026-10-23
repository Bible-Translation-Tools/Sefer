import { untrack } from "solid-js";

import { chaptersOf, chapterOf } from "./helpers";
import type { Prepared } from "./types";

export interface ChapterNavOptions {
  readonly selectedBook: () => Prepared | undefined;
  readonly place: () => number | undefined;
  readonly goToChapter: (chapter: number) => void;
}

export interface ChapterNav {
  readonly currentChapter: () => number | undefined;
  readonly chapterAt: (delta: 1 | -1) => number | undefined;
  readonly stepChapter: (delta: 1 | -1) => void;
}

export function createChapterNav(options: ChapterNavOptions): ChapterNav {
  const { selectedBook, place, goToChapter } = options;
  const currentChapter = (): number | undefined => {
    const held = selectedBook();
    const unit = held?.shown[place() ?? 0];
    return unit === undefined ? undefined : chapterOf(unit);
  };
  const chapterAt = (delta: 1 | -1): number | undefined => {
    const held = selectedBook();
    if (held === undefined) return undefined;
    const list = chaptersOf(held);
    const index = list.findIndex((row) => row.ordinal === currentChapter());
    return list[(index < 0 ? 0 : index) + delta]?.ordinal;
  };
  const stepChapter = (delta: 1 | -1): void => {
    const chapter = untrack(() => chapterAt(delta));
    if (chapter !== undefined) goToChapter(chapter);
  };
  return { currentChapter, chapterAt, stepChapter };
}
