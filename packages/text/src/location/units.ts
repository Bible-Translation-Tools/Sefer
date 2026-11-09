/**
 * Stepping through a text: the places its TOC divides it into, in order.
 *
 * What a place IS called, and where an Address is, are galley's answers
 * (`Analysis.addressAt`, `Analysis.resolve`); this module only walks the rows
 * the engine already returned, so an excerpt can show "one more above" and a
 * diff can group its hunks by the verse they fall in. The places are galley's
 * tiles: a verse begins at its `start` (the heading and paragraph marker that
 * introduce it), so the walk and galley's addresses agree on every boundary.
 */

/** One chapter row. Rows tile the text; row 0 is the front matter. */
export interface TocChapter {
  /** The designator's number; 0 for the front-matter row or a malformed `\c`. */
  readonly number: number;
  readonly from: number;
  readonly to: number;
}

/** One `\v` anchor. */
export interface TocVerse {
  /** Where the `\v` marker starts. */
  readonly at: number;
  /** Where the verse's tile starts: its heading and paragraph marker, or `at` mid-paragraph. */
  readonly start: number;
  /** The POSITION of the chapter row containing it, never its number. */
  readonly row: number;
  /** Lowest verse the designator names; 0 when it is absent or malformed. */
  readonly first: number;
  /** Highest: equal to `first` unless this is a bridge or a list. */
  readonly last: number;
  /**
   * Where the designator AS WRITTEN ends (`5`, `1-2`, `6a`), before its folded
   * space; the marker's end when there is none. So a caller wanting a verse's
   * words without its number never spells a `\v`.
   */
  readonly labelEnd: number;
}

export interface TocView {
  /** The length of the text the rows describe. */
  readonly length: number;
  readonly chapters: readonly TocChapter[];
  /** In source order. */
  readonly verses: readonly TocVerse[];
}

/**
 * One place: the introduction, a chapter's head (its `\c` up to its first
 * verse's tile), or a verse's tile. Units tile the text: each ends where the
 * next begins.
 */
export interface TocUnit {
  readonly from: number;
  readonly to: number;
  /** The chapter row this unit tiles: a POSITION in `TocView.chapters`. */
  readonly row: number;
  /** For a verse; `undefined` for the introduction and a chapter's head. */
  readonly verse?: TocVerse;
}

const unitLists = new WeakMap<TocView, readonly TocUnit[]>();

/** Every unit of `toc`, in source order. */
export const tocUnits = (toc: TocView): readonly TocUnit[] => {
  const held = unitLists.get(toc);
  if (held !== undefined) return held;
  const built = buildUnits(toc);
  unitLists.set(toc, built);
  return built;
};

/** Index of the unit containing `offset` (the last one starting at or before it), or -1. */
export const unitIndexAt = (all: readonly TocUnit[], offset: number): number => {
  let lo = 0;
  let hi = all.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const unit = all[mid];
    if (unit === undefined) break;
    if (unit.from <= offset) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
};

const buildUnits = (toc: TocView): readonly TocUnit[] => {
  const out: TocUnit[] = [];
  let next = 0;
  toc.chapters.forEach((chapter, row) => {
    const verses: TocVerse[] = [];
    while (next < toc.verses.length && toc.verses[next]?.row === row) {
      const verse = toc.verses[next];
      if (verse !== undefined) verses.push(verse);
      next += 1;
    }
    const firstAt = verses[0]?.start ?? chapter.to;
    if (firstAt > chapter.from || verses.length === 0) {
      out.push({ row, from: chapter.from, to: firstAt });
    }
    verses.forEach((verse, at) => {
      out.push({ row, verse, from: verse.start, to: verses[at + 1]?.start ?? chapter.to });
    });
  });
  return out;
};

/**
 * The highest verse this text numbers in `chapter`, or `undefined` when it
 * has no such chapter. One text's answer, not the versification's: what a
 * resource borrows to close a range its own layout leaves open
 * (`PlaceContext.versesIn`).
 */
export const lastVerseOf = (toc: TocView, chapter: number): number | undefined => {
  const row = toc.chapters.findIndex((each) => each.number === chapter);
  if (row < 0) return undefined;
  let last: number | undefined;
  for (const verse of toc.verses)
    if (verse.row === row && verse.last > 0) last = Math.max(last ?? 0, verse.last);
  return last;
};
