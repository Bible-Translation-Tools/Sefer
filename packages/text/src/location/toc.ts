/**
 * The engine's TOC rows as plain values: chapters and verse anchors, for the
 * few readers that want a designator's numbers (a chapter tile, a verse's
 * label end). Stepping through a text's places is galley's (`Analysis.units`).
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
