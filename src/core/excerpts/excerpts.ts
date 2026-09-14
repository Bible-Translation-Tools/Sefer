/**
 * Excerpts: the multibuffer's model.
 *
 * One screen shows a list of small, addressable passages — the verse a match
 * fell in, with a verse either side for context — and lets the reader open any
 * one of them for editing. Find produces that list from search hits; STET
 * produces it from a term's occurrences. Both feeds arrive here as the same
 * three fields (`bookId`, `from`, `to`), so the component above is written
 * once (planning/03-ui/design-direction.md, "Key terms (STET) reuses the Find
 * excerpt pattern").
 *
 * Two decisions this module exists to hold:
 *
 *  - **Grouping is by verse, not by hit.** Onion's table of contents names
 *    every verse anchor; a hit belongs to the last anchor at or before it, and
 *    every hit sharing an anchor shares one excerpt. Three matches in Philemon
 *    1:4 are one card with three highlights, never three cards.
 *  - **The read-only body is the PROJECTION, not the source.** A card shows
 *    what the reader sees: the text tokens of the span, with markers,
 *    designators and note bodies dropped — the same rule the engine's find
 *    runs over (`core/search/search.ts`, "TWO DOORS, ONE `Hit`"). `project`
 *    keeps a source offset per output character, so a hit found in source
 *    coordinates highlights exactly the right characters of the projection
 *    without either side guessing at the other's arithmetic.
 *
 * Everything here is pure and synchronous: text in, values out. The span it
 * computes is in SOURCE coordinates, which is what a satellite clips to, and
 * the marks it computes are in projected coordinates, which is what the
 * read-only body renders. Nothing here holds a Book, a stamp or a lifetime —
 * freshness is still `search.resolveHit`'s to judge.
 */

import type { BookId, Ref } from "../book/book";
import {
  CLASS,
  FLAG,
  TOKEN,
  TOKEN_SPELLING_BIT,
  classWordOf,
  coarse,
  has,
  type Analysis,
} from "../galley";

/** One match inside an excerpt, in the book's SOURCE coordinates. */
export interface Occurrence {
  readonly bookId: BookId;
  readonly from: number;
  readonly to: number;
  /**
   * Every source piece, when a projected match crossed markup the projection
   * dropped (`search.Hit.pieces`). Each piece is highlighted separately, which
   * is the honest picture: the gap between them is the markup.
   */
  readonly pieces?: readonly { readonly from: number; readonly to: number }[];
}

/** A range in the projected text of one excerpt. */
export interface Mark {
  readonly from: number;
  readonly to: number;
}

/**
 * One verse's worth of the multibuffer.
 *
 * `span` is the verse plus one either side, clamped to the chapter, in source
 * coordinates — what an editable satellite is clipped to. `text` is the
 * projection of exactly that span and `marks` index into it. `hits` stays in
 * source coordinates because that is what Replace and "open in editor" need.
 */
export interface Excerpt {
  readonly bookId: BookId;
  /** `PHM 1:4` — the verse anchor this excerpt is grouped under. */
  readonly sid: string;
  readonly ref: Ref;
  /** `Philemon 1:4`, for the card header. */
  readonly label: string;
  readonly span: { readonly from: number; readonly to: number };
  readonly hits: readonly Occurrence[];
  readonly text: string;
  readonly marks: readonly Mark[];
  /**
   * Where the excerpt's OWN verse sits in `text` — the rest is the verse
   * either side. A card dims the context with it, so the reader can see which
   * sentence the reference names without a second reference per line.
   */
  readonly focus: Mark | null;
  /**
   * Is there another verse of this chapter above and below what is shown?
   *
   * The card's expand chevrons are drawn from this, so "can I see more" is
   * answered by the model that knows the chapter's extent rather than by a
   * component counting anchors. Both are `false` on an excerpt with no verse
   * anchor (front matter), which is not a place expanding by verse means
   * anything.
   */
  readonly more: { readonly up: boolean; readonly down: boolean };
}

/** Every excerpt of one book, under the header the list renders. */
export interface BookExcerpts {
  readonly bookId: BookId;
  /** The book's `\h` name when it has one, else its id. */
  readonly name: string;
  readonly excerpts: readonly Excerpt[];
  /** Matches, not excerpts: "PHM · Philemon · 3 hits". */
  readonly count: number;
}

/** One row of the outline column, in the order the groups arrive. */
export interface OutlineRow {
  readonly bookId: BookId;
  readonly name: string;
  readonly count: number;
}

/** What `group` needs of each book it may build excerpts for. */
export interface BookText {
  readonly bookId: BookId;
  readonly text: string;
  readonly analysis: Analysis;
}

// ---------------------------------------------------------------------------
// Names and references
// ---------------------------------------------------------------------------

const HEADER = /^\\h[ \t]+(.+)$/m;
const TOC2 = /^\\toc2[ \t]+(.+)$/m;

/**
 * The book's display name: its `\h` running header, its `\toc2` short title,
 * or its id. Read from the text rather than from a table because the table
 * that would answer for every translation is the translation's own front
 * matter, and this is it.
 */
export const bookName = (text: string, bookId: BookId): string => {
  const header = HEADER.exec(text) ?? TOC2.exec(text);
  const found = header?.[1]?.trim();
  return found === undefined || found === "" ? bookId : found;
};

const refLabel = (name: string, ref: Ref): string =>
  ref.verse === undefined ? `${name} ${ref.chapter}` : `${name} ${ref.chapter}:${ref.verse}`;

const sidOf = (bookId: BookId, chapter: number, first: number, last: number): string =>
  `${bookId} ${chapter}:${first === last ? first : `${first}-${last}`}`;

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

/**
 * A run of projected text and where each character came from.
 *
 * `src[i]` is the source offset of `text[i]`. A per-character map rather than
 * a run table because an excerpt is three verses, the map costs a few hundred
 * bytes, and every offset question the card asks — which characters does this
 * hit cover — becomes a scan instead of a binary search plus an interval
 * intersection.
 */
export interface Projection {
  readonly text: string;
  readonly src: Int32Array;
}

const isSpace = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 13;

/**
 * The reading of `[from, to)`: text tokens only, note bodies dropped, runs of
 * whitespace collapsed to one space.
 *
 * Dropping markers is what makes this the projection rather than the source;
 * collapsing whitespace is what makes it a paragraph rather than a column of
 * USFM lines. Both are reversible for the caller's purposes because `src`
 * survives them.
 */
export const project = (analysis: Analysis, from: number, to: number): Projection => {
  const out: number[] = [];
  const map: number[] = [];
  // Note bodies are dropped whole: `\f + \ft …\f*` is apparatus, not the
  // reading, and the engine's own find agrees (galley/src/find.md).
  let note = 0;
  // Where the gap that a separating space stands for BEGAN. The space is
  // mapped there rather than onto the character that follows it, or a match
  // beginning at that character would be reported as covering the space too.
  let gapAt = -1;

  analysis.dish.tokens.forEach((kind, markerIdx, tokenFrom, tokenTo) => {
    if (tokenTo <= from) return;
    if (tokenFrom >= to) return false;
    const cls = classWordOf(markerIdx, kind);
    if (coarse(cls) === CLASS.NOTE) {
      if (has(cls, FLAG.CLOSER)) note = Math.max(0, note - 1);
      else note += 1;
      if (out.length > 0 && gapAt < 0) gapAt = Math.max(from, tokenFrom);
      return;
    }
    if (note > 0) return;
    if ((kind & ~TOKEN_SPELLING_BIT) !== TOKEN.TEXT) {
      // Everything the projection drops still separates words.
      if (out.length > 0 && gapAt < 0) gapAt = Math.max(from, tokenFrom);
      return;
    }
    const start = Math.max(tokenFrom, from);
    const end = Math.min(tokenTo, to);
    for (let at = start; at < end; at += 1) {
      const code = analysis.text.charCodeAt(at);
      if (isSpace(code)) {
        if (out.length > 0 && gapAt < 0) gapAt = at;
        continue;
      }
      if (gapAt >= 0) {
        out.push(32);
        map.push(gapAt);
        gapAt = -1;
      }
      out.push(code);
      map.push(at);
    }
    return;
  });

  // Chunked: `String.fromCharCode(...)` spreads onto the argument stack, and
  // an excerpt is short but a caller may project a whole chapter.
  let text = "";
  for (let at = 0; at < out.length; at += 4096)
    text += String.fromCharCode(...out.slice(at, at + 4096));

  return { text, src: Int32Array.from(map) };
};

/**
 * The projected ranges covering `[from, to)` of the source — one per
 * contiguous run, because the projection may have dropped something inside it.
 */
const marksFor = (
  projection: Projection,
  ranges: readonly { readonly from: number; readonly to: number }[],
): readonly Mark[] => {
  const marks: Mark[] = [];
  const { src } = projection;
  for (const range of ranges) {
    let open = -1;
    for (let index = 0; index < src.length; index += 1) {
      // SAFETY: `index` is inside the typed array's own length.
      const at = src[index]!;
      const inside = at >= range.from && at < range.to;
      if (inside && open < 0) open = index;
      else if (!inside && open >= 0) {
        marks.push({ from: open, to: index });
        open = -1;
      }
    }
    if (open >= 0) marks.push({ from: open, to: src.length });
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  return marks;
};

// ---------------------------------------------------------------------------
// Verses
// ---------------------------------------------------------------------------

/**
 * A verse anchor with the extent it owns: from its own anchor to the next
 * anchor in the same chapter, or to the end of the chapter.
 */
interface VerseSpan {
  readonly chapter: number;
  readonly first: number;
  readonly last: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Every verse of the book, in order, each tiling forward to the next.
 *
 * Onion's toc gives anchors and chapter extents; the tiling is arithmetic over
 * them, and it is here rather than in the engine because "how much text does
 * this verse own" is a display question — the anchor is the fact.
 */
export const verseSpans = (analysis: Analysis): readonly VerseSpan[] => {
  const chapters = analysis.dish.toc.chapters();
  const ends = new Map<number, number>();
  for (const chapter of chapters) ends.set(chapter.number, chapter.to);

  const rows = analysis.dish.toc.verses();
  const spans: VerseSpan[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    // SAFETY: `index` is inside the array this loop is bounded by.
    const row = rows[index]!;
    const next = rows[index + 1];
    const chapterEnd = ends.get(row.chapter) ?? analysis.docLen;
    const to =
      next !== undefined && next.chapter === row.chapter
        ? Math.min(next.at, chapterEnd)
        : chapterEnd;
    spans.push({
      chapter: row.chapter,
      first: row.first,
      last: row.last,
      from: row.at,
      to: Math.max(row.at, to),
    });
  }
  return spans;
};

/** Index of the last verse anchored at or before `pos`, or -1. */
const verseAt = (spans: readonly VerseSpan[], pos: number): number => {
  let low = 0;
  let high = spans.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    // SAFETY: `middle` is inside [low, high], which is inside the array.
    if (spans[middle]!.from <= pos) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
};

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const rangesOf = (hit: Occurrence): readonly { from: number; to: number }[] =>
  hit.pieces !== undefined && hit.pieces.length > 1
    ? hit.pieces.map((piece) => ({ from: piece.from, to: piece.to }))
    : [{ from: hit.from, to: hit.to }];

/**
 * The excerpts of one book: one per verse that holds at least one occurrence,
 * in document order, each carrying every occurrence inside it.
 *
 * An occurrence before the book's first verse anchor (front matter, a chapter
 * heading) still gets an excerpt — clamped to its chapter, or to the head of
 * the book — rather than being dropped, because a match the reader can see is
 * a match the list must show.
 */
/**
 * How many verses either side of its own the excerpt shows. One each is the
 * default: context is what makes a one-line hit readable, and more than that
 * is the reader's choice, made with the card's chevrons.
 */
export interface Extent {
  readonly up: number;
  readonly down: number;
}

const ONE_EITHER_SIDE: Extent = { up: 1, down: 1 };

/**
 * Walk `steps` verses from `index` without leaving the chapter.
 *
 * Clamped to the CHAPTER, deliberately: a neighbour from the next chapter is
 * not context, it is a different place — the same rule the default extent
 * follows, applied however far the reader expands.
 */
const walk = (spans: readonly VerseSpan[], index: number, steps: number, by: -1 | 1): number => {
  const chapter = spans[index]?.chapter;
  let at = index;
  for (let taken = 0; taken < steps; taken += 1) {
    const next = spans[at + by];
    if (next === undefined || next.chapter !== chapter) break;
    at += by;
  }
  return at;
};

/**
 * One excerpt: the verse at `index`, `extent` verses either side, and every
 * occurrence it owns.
 *
 * `excerptsOf` and `extend` both come through here, so a card the reader has
 * expanded is built by exactly the same arithmetic as the card they started
 * with — only the extent differs.
 */
const buildExcerpt = (
  book: BookText,
  spans: readonly VerseSpan[],
  name: string,
  chapters: readonly { readonly number: number; readonly from: number; readonly to: number }[],
  index: number,
  held: readonly Occurrence[],
  extent: Extent,
): Excerpt => {
  const verse = index < 0 ? undefined : spans[index];
  const chapter =
    verse?.chapter ??
    chapters.find((row) => row.from <= (held[0]?.from ?? 0) && (held[0]?.from ?? 0) < row.to)
      ?.number ??
    0;

  const low = verse === undefined ? index : walk(spans, index, extent.up, -1);
  const high = verse === undefined ? index : walk(spans, index, extent.down, 1);
  const from =
    verse === undefined
      ? (chapters.find((row) => row.number === chapter)?.from ?? 0)
      : (spans[low]?.from ?? verse.from);
  const to =
    verse === undefined ? (spans[0]?.from ?? book.analysis.docLen) : (spans[high]?.to ?? verse.to);

  const projection = project(book.analysis, from, to);
  const ref: Ref =
    verse === undefined
      ? { book: book.bookId, chapter }
      : { book: book.bookId, chapter: verse.chapter, verse: verse.first };

  return {
    bookId: book.bookId,
    sid:
      verse === undefined
        ? `${book.bookId} ${chapter}`
        : sidOf(book.bookId, verse.chapter, verse.first, verse.last),
    ref,
    label: refLabel(name, ref),
    span: { from, to },
    hits: held,
    text: projection.text,
    marks: marksFor(projection, held.flatMap(rangesOf)),
    focus:
      verse === undefined
        ? null
        : (marksFor(projection, [{ from: verse.from, to: verse.to }])[0] ?? null),
    more:
      verse === undefined
        ? { up: false, down: false }
        : {
            up: walk(spans, low, 1, -1) !== low,
            down: walk(spans, high, 1, 1) !== high,
          },
  };
};

/**
 * The excerpts of one book: one per verse that holds at least one occurrence,
 * in document order, each carrying every occurrence inside it.
 *
 * An occurrence before the book's first verse anchor (front matter, a chapter
 * heading) still gets an excerpt — clamped to its chapter, or to the head of
 * the book — rather than being dropped, because a match the reader can see is
 * a match the list must show.
 */
export const excerptsOf = (book: BookText, hits: readonly Occurrence[]): readonly Excerpt[] => {
  if (hits.length === 0) return [];
  const spans = verseSpans(book.analysis);
  const name = bookName(book.text, book.bookId);
  const chapters = book.analysis.dish.toc.chapters();

  // Verse index (or -1 for "before the first anchor") → the hits it owns, in
  // the order they arrived, which is offset order for both feeds.
  const grouped = new Map<number, Occurrence[]>();
  const order: number[] = [];
  for (const hit of [...hits].sort((a, b) => a.from - b.from)) {
    const index = verseAt(spans, hit.from);
    const held = grouped.get(index);
    if (held === undefined) {
      grouped.set(index, [hit]);
      order.push(index);
    } else held.push(hit);
  }

  const out: Excerpt[] = [];
  for (const index of order)
    out.push(
      buildExcerpt(book, spans, name, chapters, index, grouped.get(index) ?? [], ONE_EITHER_SIDE),
    );
  return out;
};

/**
 * The same excerpt, showing `extent` verses either side of its own.
 *
 * Rebuilt from the verse anchor rather than grown from the span it has, so
 * expanding is idempotent in the extent: the card holds "two up, one down",
 * not a span it has been nudging. An excerpt with no verse anchor comes back
 * unchanged — there is nothing to count in either direction.
 */
export const extend = (book: BookText, excerpt: Excerpt, extent: Extent): Excerpt => {
  const spans = verseSpans(book.analysis);
  const index = verseAt(spans, excerpt.hits[0]?.from ?? excerpt.span.from);
  if (index < 0) return excerpt;
  return buildExcerpt(
    book,
    spans,
    bookName(book.text, book.bookId),
    book.analysis.dish.toc.chapters(),
    index,
    excerpt.hits,
    { up: Math.max(1, extent.up), down: Math.max(1, extent.down) },
  );
};

/**
 * Every feed's last step: hits from any number of books, grouped into the
 * per-book groups the list renders and the outline it is steered by.
 *
 * `books` is the caller's order, and the caller's order is canonical — a
 * Project lists its books the way its files sort. A book with no hits is not a
 * group and not an outline row: an outline is a map of the result, not of the
 * project.
 */
export const group = (
  books: readonly BookText[],
  hits: readonly Occurrence[],
): { readonly groups: readonly BookExcerpts[]; readonly outline: readonly OutlineRow[] } => {
  const byBook = new Map<BookId, Occurrence[]>();
  for (const hit of hits) {
    const held = byBook.get(hit.bookId);
    if (held === undefined) byBook.set(hit.bookId, [hit]);
    else held.push(hit);
  }

  const groups: BookExcerpts[] = [];
  for (const book of books) {
    const held = byBook.get(book.bookId);
    if (held === undefined || held.length === 0) continue;
    const excerpts = excerptsOf(book, held);
    if (excerpts.length === 0) continue;
    groups.push({
      bookId: book.bookId,
      name: bookName(book.text, book.bookId),
      excerpts,
      count: held.length,
    });
  }

  return {
    groups,
    outline: groups.map((entry) => ({
      bookId: entry.bookId,
      name: entry.name,
      count: entry.count,
    })),
  };
};
