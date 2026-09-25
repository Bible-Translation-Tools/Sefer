/**
 * The engine's TOC, as Location reads it.
 *
 * `core/location` answers "where is LUK 3:1" and "what is at this offset"
 * over a plain `TocView` so that it imports no engine; this is the one place
 * the dish's rows become that shape. Two things change on the way:
 *
 * - A verse row's `chapter` in the dish is the enclosing chapter's NUMBER.
 *   Location wants the row's POSITION, because a book with two `\c 3`s has
 *   two chapter 3s and a number cannot say which one a verse is in. Chapter
 *   rows tile, so the position is a merge walk.
 * - One view per dish, built on first ask and kept beside it: a Findings
 *   panel labels hundreds of sites against one analysis.
 */

import type { TocChapter, TocVerse, TocView } from "../location/locate";
import type { Analysis } from "./analysis";

const views = new WeakMap<Analysis["dish"], TocView>();

export const tocViewOf = (analysis: Analysis): TocView => {
  const dish = analysis.dish;
  const held = views.get(dish);
  if (held !== undefined) return held;

  const chapters: TocChapter[] = dish.toc
    .chapters()
    .map((row) => ({ number: row.number, from: row.from, to: row.to }));
  const verses: TocVerse[] = [];
  let row = 0;
  // The row cursor rather than `forEachVerse`, which does not pass the label;
  // `verses()` would, at the cost of a members array per verse.
  const rows = dish.toc.verseRows;
  for (let i = 0, n = rows.length; i < n; i++) {
    const verse = rows.seek(i);
    const at = verse.at;
    while (row < chapters.length - 1 && at >= (chapters[row]?.to ?? 0)) row += 1;
    verses.push({ at, row, first: verse.first, last: verse.last, labelEnd: verse.labelEnd });
  }

  const view: TocView = { length: analysis.docLen, chapters, verses };
  views.set(dish, view);
  return view;
};
