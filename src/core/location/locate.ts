/**
 * Location: where an Address is in ONE text, and what Address an offset is in.
 *
 *     resolve(toc, LUK 3:1)        → found 1204..1388, covers LUK 3:1
 *     resolve(toc, LUK 1:2)        → found over `\v 1-2`, covers LUK 1:1-2
 *     resolve(toc, LUK 30:1)       → missing chapter
 *     addressAt(LUK, toc, 1300)    → LUK 3:1
 *
 * Every answer comes from the TOC of the one text being asked about, which the
 * engine built; nothing here reads USFM. The TOC arrives as `TocView`, a plain
 * shape `core/galley` adapts the engine's rows into, so this module imports no
 * engine and runs anywhere core runs.
 *
 * The CALLER proves the TOC describes the text its offsets will index — an
 * exact analysis, a matching engine stamp. A TOC of different text answers
 * confidently and wrongly, and nothing here can tell.
 *
 * Extents are STRUCTURAL: a verse runs from its `\v` marker to the next verse
 * marker or the end of its chapter, so a section heading before verse 4 sits
 * inside verse 3's extent. A content-only extent (the words, without the
 * heading) is a second, differently named answer to add when a quotation or a
 * preview needs it — never the same unlabelled `from`/`to`.
 *
 * Offsets are UTF-16 code units, half-open.
 */

import type { BookId } from "../book/book";
import {
  bookAddress,
  chaptersAddress,
  introAddress,
  versesAddress,
  type Address,
  type Point,
} from "./address";

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
  /** The POSITION of the chapter row containing it, never its number. */
  readonly row: number;
  /** Lowest verse the designator names; 0 when it is absent or malformed. */
  readonly first: number;
  /** Highest — equal to `first` unless this is a bridge. */
  readonly last: number;
}

export interface TocView {
  /** The length of the text the rows describe. */
  readonly length: number;
  readonly chapters: readonly TocChapter[];
  /** In source order. */
  readonly verses: readonly TocVerse[];
}

export interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * The places a TOC divides its text into, in source order, each tiling the
 * chapter it is in: the introduction, a chapter's head (its `\c` up to its
 * first verse), and each verse.
 */
interface Unit extends Span {
  readonly row: number;
  /** For a verse; `undefined` for the introduction and a chapter's head. */
  readonly verse?: TocVerse;
}

const units = (toc: TocView): readonly Unit[] => {
  const out: Unit[] = [];
  let next = 0;
  toc.chapters.forEach((chapter, row) => {
    const verses: TocVerse[] = [];
    while (next < toc.verses.length && toc.verses[next]?.row === row) {
      const verse = toc.verses[next];
      if (verse !== undefined) verses.push(verse);
      next += 1;
    }
    const firstAt = verses[0]?.at ?? chapter.to;
    if (firstAt > chapter.from || verses.length === 0) {
      out.push({ row, from: chapter.from, to: firstAt });
    }
    verses.forEach((verse, at) => {
      out.push({ row, verse, from: verse.at, to: verses[at + 1]?.at ?? chapter.to });
    });
  });
  return out;
};

/**
 * The Address one unit names. A bridge names its whole range: a caret in
 * `\v 1-2` is in LUK 1:1-2, whichever of the two verses it was asked for by.
 */
const unitAddress = (book: BookId, toc: TocView, unit: Unit): Address => {
  const chapter = toc.chapters[unit.row];
  if (unit.row === 0) return introAddress(book);
  if (chapter === undefined || chapter.number === 0) return bookAddress(book);
  const verse = unit.verse;
  if (verse === undefined || verse.first === 0) return chaptersAddress(book, chapter.number);
  return versesAddress(
    book,
    { chapter: chapter.number, verse: verse.first },
    { chapter: chapter.number, verse: verse.last },
  );
};

const sameAddress = (a: Address, b: Address): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The Address at one offset, or `undefined` for an offset outside the text.
 *
 * `[0, length]`: the end-of-document caret is a real position and lands in
 * the last place, but anything past it is invalid input, not a clamp — the
 * engine's own `locate` clamps because it only labels, and this also answers
 * questions that act.
 */
export const addressAt = (book: BookId, toc: TocView, offset: number): Address | undefined => {
  if (!Number.isInteger(offset) || offset < 0 || offset > toc.length) return undefined;
  const all = units(toc);
  // The last unit starting at or before the offset. Units tile, so that is
  // the one containing it (or ending at it, for the final caret).
  let lo = 0;
  let hi = all.length - 1;
  let found: Unit | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const unit = all[mid];
    if (unit === undefined) break;
    if (unit.from <= offset) {
      found = unit;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found === undefined ? undefined : unitAddress(book, toc, found);
};

/**
 * Every Address a selection covers, in order and without repeats. Half-open:
 * a selection ending exactly where a verse begins does not include that
 * verse. An empty selection asks `addressAt(from)`. Gaps between the places
 * are not filled in — two verses a selection touches are two Addresses, never
 * one range asserting it covered what lies between.
 *
 * Not exported yet: `resolve` is its only caller until a selection needs its
 * Addresses (a comment anchor, a Find hit over several verses).
 */
const addressesCovering = (book: BookId, toc: TocView, span: Span): readonly Address[] => {
  if (span.from === span.to) {
    const one = addressAt(book, toc, span.from);
    return one === undefined ? [] : [one];
  }
  if (span.from < 0 || span.to > toc.length || span.from > span.to) return [];
  const out: Address[] = [];
  for (const unit of units(toc)) {
    if (unit.to <= span.from || unit.from >= span.to) continue;
    const address = unitAddress(book, toc, unit);
    const last = out[out.length - 1];
    if (last === undefined || !sameAddress(last, address)) out.push(address);
  }
  return out;
};

export type Resolution =
  | {
      readonly kind: "found";
      readonly from: number;
      readonly to: number;
      /** What the span actually is: `LUK 1:1-2` when `LUK 1:2` landed in a bridge. */
      readonly covers: Address;
      /**
       * True when the text could only answer less precisely than asked: a
       * segment (`3a`) the TOC cannot see, so the whole verse was found. Show
       * it as found, never as exact.
       */
      readonly coarser: boolean;
    }
  | {
      readonly kind: "missing";
      readonly missing: "intro" | "chapter" | "verse";
      /** The nearest enclosing place that IS there — the chapter, for a verse. */
      readonly within?: Span;
    }
  | {
      /** Malformed text: two `\c 3`s, or two anchors for one verse. */
      readonly kind: "ambiguous";
      readonly spans: readonly Span[];
    };

type Endpoint =
  | { readonly kind: "unit"; readonly unit: Span }
  | Exclude<Resolution, { readonly kind: "found" }>;

const chapterRows = (toc: TocView, number: number): number[] =>
  toc.chapters.flatMap((chapter, row) => (row > 0 && chapter.number === number ? [row] : []));

const oneChapter = (toc: TocView, number: number): Endpoint => {
  const rows = chapterRows(toc, number);
  const spans = rows.map((row) => toc.chapters[row]).filter((row) => row !== undefined);
  if (spans.length === 0) return { kind: "missing", missing: "chapter" };
  if (spans.length > 1) return { kind: "ambiguous", spans };
  const [only] = spans;
  return only === undefined
    ? { kind: "missing", missing: "chapter" }
    : { kind: "unit", unit: only };
};

const oneVerse = (toc: TocView, all: readonly Unit[], point: Point): Endpoint => {
  const chapter = oneChapter(toc, point.chapter);
  if (chapter.kind !== "unit") return chapter;
  const row = chapterRows(toc, point.chapter)[0];
  const hits = all.filter(
    (unit) =>
      unit.row === row &&
      unit.verse !== undefined &&
      unit.verse.first > 0 &&
      unit.verse.first <= point.verse &&
      point.verse <= unit.verse.last,
  );
  if (hits.length === 0) return { kind: "missing", missing: "verse", within: chapter.unit };
  if (hits.length > 1) return { kind: "ambiguous", spans: hits };
  const [only] = hits;
  return only === undefined
    ? { kind: "missing", missing: "verse", within: chapter.unit }
    : { kind: "unit", unit: only };
};

/**
 * Where an Address is in this text: `found`, `missing` (with the enclosing
 * place that is there, so a caller can choose to stop at the chapter), or
 * `ambiguous` when malformed text offers two answers — never a silent pick of
 * the first, because an action that attaches or edits must not guess.
 *
 * The Address's book is the caller's to match with the text; this sees one
 * TOC and answers for it.
 */
export const resolve = (toc: TocView, address: Address): Resolution => {
  switch (address.kind) {
    case "book":
      return { kind: "found", from: 0, to: toc.length, covers: address, coarser: false };
    case "intro": {
      const front = toc.chapters[0];
      if (front === undefined || front.to <= front.from)
        return { kind: "missing", missing: "intro" };
      return { kind: "found", from: front.from, to: front.to, covers: address, coarser: false };
    }
    case "chapters": {
      const from = oneChapter(toc, address.from);
      if (from.kind !== "unit") return from;
      const to = address.to === address.from ? from : oneChapter(toc, address.to);
      if (to.kind !== "unit") return to;
      return {
        kind: "found",
        from: Math.min(from.unit.from, to.unit.from),
        to: Math.max(from.unit.to, to.unit.to),
        covers: address,
        coarser: false,
      };
    }
    case "verses": {
      const all = units(toc);
      const from = oneVerse(toc, all, address.from);
      if (from.kind !== "unit") return from;
      const to = oneVerse(toc, all, address.to);
      if (to.kind !== "unit") return to;
      const span = {
        from: Math.min(from.unit.from, to.unit.from),
        to: Math.max(from.unit.to, to.unit.to),
      };
      const covered = addressesCovering(address.book, toc, span);
      const first = covered[0];
      const last = covered[covered.length - 1];
      const covers =
        first?.kind === "verses" && last?.kind === "verses"
          ? versesAddress(address.book, first.from, last.to)
          : address;
      return {
        kind: "found",
        ...span,
        covers,
        // The TOC carries no segments yet (Kitchen ask 5), so `3a` finds all
        // of verse 3 and says so.
        coarser: address.from.segment !== undefined || address.to.segment !== undefined,
      };
    }
  }
};
