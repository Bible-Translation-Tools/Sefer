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
 * - A verse's MEMBERS (what `\v 1,3,5` or `\v 12a` covers, where `first`
 *   and `last` are only the hull) are carried only when they say something
 *   the hull does not: a list, or a segment. `\v 3` and `\v 1-2` — nearly
 *   every verse — carry none, so a whole book costs no array per verse. A
 *   segment arrives as a span into the text and leaves as its letters.
 * - One view per dish, built on first ask and kept beside it: a Findings
 *   panel labels hundreds of sites against one analysis.
 */

import type { TocChapter, TocMember, TocVerse, TocView } from "../location/locate";
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
  // The row cursors rather than `verses()`, which builds a members array for
  // every verse; the plain ones never need theirs.
  const rows = dish.toc.verseRows;
  const memberRows = dish.toc.memberRows;
  const text = analysis.text;
  const letters = (from: number, to: number): string | undefined =>
    to > from ? text.slice(from, to) : undefined;
  for (let i = 0, n = rows.length; i < n; i++) {
    const verse = rows.seek(i);
    const at = verse.at;
    while (row < chapters.length - 1 && at >= (chapters[row]?.to ?? 0)) row += 1;
    const first = verse.first;
    const last = verse.last;
    const membersFrom = verse.membersFrom;
    const membersLen = verse.membersLen;
    const labelEnd = verse.labelEnd;
    let members: TocMember[] | undefined;
    const only = membersLen === 1 ? memberRows.seek(membersFrom) : undefined;
    const plain =
      membersLen === 0 ||
      (only !== undefined &&
        only.from === first &&
        only.to === last &&
        only.fromSegmentEnd === only.fromSegmentStart &&
        only.toSegmentEnd === only.toSegmentStart);
    if (!plain) {
      members = [];
      for (let m = membersFrom, end = membersFrom + membersLen; m < end; m++) {
        const member = memberRows.seek(m);
        members.push({
          from: member.from,
          fromSegment: letters(member.fromSegmentStart, member.fromSegmentEnd),
          to: member.to,
          toSegment: letters(member.toSegmentStart, member.toSegmentEnd),
        });
      }
    }
    verses.push(
      members === undefined
        ? { at, row, first, last, labelEnd }
        : { at, row, first, last, labelEnd, members },
    );
  }

  const view: TocView = { length: analysis.docLen, chapters, verses };
  views.set(dish, view);
  return view;
};
