// verses.ts
//
// Two texts of one book, laid out verse beside verse.
//
// `diff.ts` answers "which LINES changed", which is what a revert needs and
// what a machine reads. A translator reads verses: "Mark 5:14 was this, and is
// now that". Aligning by reference rather than by line is also the only way
// two columns can stay level down the page — a line diff puts an inserted
// paragraph on one side and pushes everything after it out of step, which is
// exactly the reading a side-by-side view exists to prevent.
//
// The alignment key is the verse's own reference, taken from the engine's
// table of contents. That is deliberately NOT a fuzzy match: a verse that was
// renumbered reads as one verse gone and another arrived, which is true, and
// is a thing the reviewer should see rather than a thing an aligner should
// quietly smooth over.
//
// Nothing here parses USFM. The spans arrive already extracted — the shell
// asks `Galley.analyze(text).dish.toc` for them (`src/app/ui/panels/verses.ts`)
// — so this module stays pure, synchronous and engine-free, like `diff.ts`
// beside it.

import type { BookId } from "../book/book";
import type { SourceStamp } from "../source/source";
import type { Hunk } from "./diff";

/**
 * One addressable run of a book: a verse, or the matter before the first verse
 * of a chapter (chapter 0 is the matter before the first `\c` — an id line, a
 * heading, a table of contents entry).
 */
export interface VerseSpan {
  readonly chapter: number;
  /** First verse named; 0 for a chapter's front matter. */
  readonly verse: number;
  /** Last verse named — a bridge `\v 5-7` names 5 through 7. */
  readonly lastVerse: number;
  /** Half-open UTF-16 range into the text these spans were taken from. */
  readonly from: number;
  readonly to: number;
}

/** `5:14`, or `5:14-16` for a bridge, or `5` for a chapter's front matter. */
export const referenceOf = (span: {
  chapter: number;
  verse: number;
  lastVerse: number;
}): string => {
  if (span.verse === 0) return span.chapter === 0 ? "front" : `${span.chapter}`;
  const range = span.lastVerse > span.verse ? `-${span.lastVerse}` : "";
  return `${span.chapter}:${span.verse}${range}`;
};

/** The alignment key. Two spans align when they name the same reference. */
const keyOf = (span: VerseSpan): string => `${span.chapter}:${span.verse}:${span.lastVerse}`;

export type RowKind = "same" | "changed" | "added" | "removed";

/**
 * One row of the side-by-side view: the same reference on both sides, or a
 * reference only one side has.
 *
 * `from`/`to` are offsets into the WORKING text, so a row can be handed
 * straight to `book.apply` — which is what makes per-verse Revert the same
 * operation per-hunk Revert already is. A row that exists only on the baseline
 * side has a zero-width working range at the point it would be reinserted.
 */
export interface VerseRow {
  readonly key: string;
  readonly reference: string;
  readonly chapter: number;
  readonly kind: RowKind;
  readonly baseline: string;
  readonly working: string;
  readonly from: number;
  readonly to: number;
  readonly baselineFrom: number;
  readonly baselineTo: number;
}

/** The rows of one chapter, in reading order. */
export interface ChapterRows {
  readonly chapter: number;
  readonly rows: readonly VerseRow[];
  /** How many of them are not `same`. A chapter with none is usually folded. */
  readonly changed: number;
}

const sliceOf = (text: string, span: VerseSpan | undefined): string =>
  span === undefined ? "" : text.slice(span.from, span.to);

/**
 * The two texts as rows, in the WORKING text's order, with baseline-only
 * references inserted where they were.
 *
 * The order is the working side's because that is the document the reviewer is
 * editing; a verse the working text has lost is placed after the last row they
 * still share, which is where it used to be.
 */
export const alignVerses = (
  baselineText: string,
  baselineSpans: readonly VerseSpan[],
  workingText: string,
  workingSpans: readonly VerseSpan[],
): readonly VerseRow[] => {
  /** Where a key first appears on the baseline side; a repeat is not an anchor. */
  const baselineAt = new Map<string, number>();
  baselineSpans.forEach((span, index) => {
    const key = keyOf(span);
    if (!baselineAt.has(key)) baselineAt.set(key, index);
  });

  const rows: VerseRow[] = [];
  /** How far the baseline walk has got. Everything behind it is accounted for. */
  let cursor = 0;
  /** Where a baseline-only verse would be reinserted: the end of the last row. */
  let anchor = 0;

  const removedRow = (span: VerseSpan): VerseRow => {
    const baseline = sliceOf(baselineText, span);
    return {
      key: keyOf(span),
      reference: referenceOf(span),
      chapter: span.chapter,
      kind: "removed",
      baseline,
      working: "",
      from: anchor,
      to: anchor,
      baselineFrom: span.from,
      baselineTo: span.to,
    };
  };

  /** Every baseline verse up to `until` that the working text no longer has. */
  const drain = (until: number): void => {
    while (cursor < until) {
      const span = baselineSpans[cursor];
      cursor += 1;
      if (span !== undefined) rows.push(removedRow(span));
    }
  };

  for (const span of workingSpans) {
    const key = keyOf(span);
    const found = baselineAt.get(key);
    // A match behind the cursor has already been paired or drained: treat this
    // occurrence as new rather than reaching backwards, which would cross rows.
    const matched = found !== undefined && found >= cursor ? baselineSpans[found] : undefined;
    if (matched !== undefined && found !== undefined) {
      drain(found);
      cursor = found + 1;
    }
    const working = sliceOf(workingText, span);
    const baseline = sliceOf(baselineText, matched);
    rows.push({
      key,
      reference: referenceOf(span),
      chapter: span.chapter,
      kind: matched === undefined ? "added" : baseline === working ? "same" : "changed",
      baseline,
      working,
      from: span.from,
      to: span.to,
      baselineFrom: matched?.from ?? anchor,
      baselineTo: matched?.to ?? anchor,
    });
    anchor = span.to;
  }
  // Whatever the baseline still holds past the last verse the two share.
  drain(baselineSpans.length);
  return rows;
};

/** The same rows, grouped by chapter in the order they appear. */
export const byChapter = (rows: readonly VerseRow[]): readonly ChapterRows[] => {
  const grouped: { chapter: number; rows: VerseRow[] }[] = [];
  for (const row of rows) {
    const last = grouped.at(-1);
    if (last !== undefined && last.chapter === row.chapter) {
      last.rows.push(row);
      continue;
    }
    grouped.push({ chapter: row.chapter, rows: [row] });
  }
  return grouped.map((chapter) => ({
    chapter: chapter.chapter,
    rows: chapter.rows,
    changed: chapter.rows.filter((row) => row.kind !== "same").length,
  }));
};

/**
 * One row as a revertable hunk.
 *
 * The row already carries both ranges and both texts, which is the whole of
 * what `diff.revert` splices; the stamp is the book's, because a hunk computed
 * from one revision means nothing against another and `stale` is what checks
 * it. An `added` row reverts to nothing (the verse is deleted), a `removed`
 * row reverts by reinserting it — both of which are what "put the file's
 * version back" means for that row.
 */
export const hunkOf = (row: VerseRow, bookId: BookId, stamp: SourceStamp): Hunk => ({
  bookId,
  stamp,
  from: row.from,
  to: row.to,
  baselineFrom: row.baselineFrom,
  baselineTo: row.baselineTo,
  kind: row.working === "" ? "delete" : row.baseline === "" ? "insert" : "replace",
  working: row.working,
  baseline: row.baseline,
});
