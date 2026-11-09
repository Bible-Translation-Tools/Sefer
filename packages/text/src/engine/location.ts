import type { TocChapter, TocVerse, TocView } from "../location/units";
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
  const rows = dish.toc.verseRows;
  for (let i = 0, n = rows.length; i < n; i++) {
    const verse = rows.seek(i);
    const at = verse.at;
    while (row < chapters.length - 1 && at >= (chapters[row]?.to ?? 0)) row += 1;
    verses.push({
      at,
      start: verse.start,
      row,
      first: verse.first,
      last: verse.last,
      labelEnd: verse.labelEnd,
    });
  }

  const view: TocView = { length: analysis.docLen, chapters, verses };
  views.set(dish, view);
  return view;
};
