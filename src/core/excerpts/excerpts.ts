/**
 * Excerpts: the multibuffer's model.
 *
 * One screen shows a list of small, addressable pieces of a book — the place a
 * match fell in, with its neighbours for context — each one a clipped view of
 * the book that the reader can open for editing. Find produces that list from
 * search hits, STET from a term's occurrences, Findings from diagnostics. All
 * of them arrive here as the same three fields (`bookId`, `from`, `to`), so the
 * card above is written once (`planning/00-ideas/excerpt-compound-component.md`).
 *
 * Three decisions this module exists to hold:
 *
 *  - **Grouping is by TOC unit, not by hit.** Location's units tile the book —
 *    the introduction, each chapter's head, each verse — and a hit belongs to
 *    the unit it falls in. Three matches in Philemon 1:4 are one card with
 *    three highlights, never three cards.
 *  - **Context is TOC steps.** "One more above" is the unit above, whatever
 *    it is; "the chapter" is the own unit's chapter row. The shown range is
 *    a pair of Addresses, which is what a paired resource is locked to.
 *  - **A card is a view of the book, not a copy.** An excerpt names a range
 *    of one parse; the card renders the editor's own projection over it. What
 *    is computed here in projected coordinates (`marks`) is for the questions
 *    only the reading can answer — does this hit have a character a reader
 *    can see at all.
 *
 * Everything here is pure and synchronous: text in, values out. Spans are in
 * SOURCE coordinates, which is what a view clips to. Nothing here holds a
 * Book, a stamp or a lifetime — freshness is the search hit's stamp to judge
 * (`search.planReplace`).
 */

import type { BookId } from "../book/book";
import {
  CLASS,
  FLAG,
  TOKEN,
  TOKEN_SPELLING_BIT,
  classWordOf,
  coarse,
  has,
  tocViewOf,
  type Analysis,
} from "../galley";
import { addressCode, bookAddress, type Address } from "../location/address";
import {
  resolve,
  tocUnits,
  unitAddress,
  unitIndexAt,
  type TocUnit,
  type TocView,
} from "../location/locate";

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
  /**
   * The SOURCE offset of the occurrence this mark came from, when it came from
   * one. It is the mark's identity, not its position: one occurrence can
   * produce several marks (a match that crossed markup), and the card needs to
   * know which of the highlights on screen belong to the match the find bar's
   * cursor is on.
   */
  readonly source?: number;
}

/**
 * One card's worth of a book, and what to paint on it.
 *
 * The card is a VIEW of the book, not a copy of it: it renders the editor's
 * own projection over `analysis`, clipped to `span`, so what a reader sees in
 * a list is what the editor shows at that place. This value says which part
 * of which parse, where the matches are, and how far the reader has widened
 * it — and nothing about how it is drawn.
 *
 * Two fields are LAZY — `source` and `marks`, the ones that slice or project
 * the text. `/findings` on a 66-book project builds twenty thousand of these
 * and shows about twenty; everything a feed needs in order to GROUP, COUNT,
 * ORDER and ESTIMATE is arithmetic over the TOC, so all of that stays eager
 * and the twenty cards on screen pay for themselves.
 *
 * The laziness is invisible and must stay so: every field reads like a value,
 * an excerpt is still a plain immutable object, and the memo is a closure with
 * no signal in it — `src/core` owns no reactivity (`pnpm boundaries`).
 *
 * One rule for callers: do NOT object-spread an excerpt. `{ ...excerpt }`
 * evaluates every getter, which is exactly the cost this shape exists to
 * avoid. Spreading the ARRAY is fine.
 */
export interface Excerpt {
  readonly bookId: BookId;
  /**
   * `PHM 1:4` — the place this excerpt is grouped under, in its machine
   * spelling (`addressCode`): `JUD 1:1-2` for a bridge, `PSA 0` for the
   * introduction. A key, never parsed back: `address` is the value.
   */
  readonly sid: string;
  /**
   * The place the excerpt's own unit IS, from Location over the book's TOC:
   * a bridge is its whole range, the matter before the first chapter is
   * `intro`, a chapter's head is that chapter.
   */
  readonly address: Address;
  /** `Philemon 1:4`, for the card header — `BookText.label` of `address`. */
  readonly label: string;
  /**
   * What is shown, in SOURCE coordinates: the own unit and its context, less
   * any tail with nothing to read in it (a bare `\p` before the next verse).
   */
  readonly span: { readonly from: number; readonly to: number };
  /** The own unit alone, in source coordinates. The rest of `span` is context. */
  readonly own: { readonly from: number; readonly to: number };
  readonly hits: readonly Occurrence[];
  /**
   * The whole book's parse, which `span` and every offset here index into.
   * The card mounts its view over this text and borrows this parse, so a list
   * of forty cards over one book analyses it once.
   */
  readonly analysis: Analysis;
  /**
   * The raw USFM of exactly `span` — markers and all. A slice, so a hit's
   * source offsets index into it once `span.from` is subtracted.
   */
  readonly source: string;
  /**
   * The hits as ranges of the PROJECTED text of `span`. Empty for a hit the
   * reading has no character of — one inside a marker, which Findings says
   * in words rather than highlighting the wrong thing.
   */
  readonly marks: readonly Mark[];
  /** How far the reader has widened it; what `extend` was last asked for. */
  readonly extent: Extent;
  /** The first and last places shown — what a paired resource is locked to. */
  readonly shown: { readonly first: Address; readonly last: Address };
  /** Is there another TOC unit above and below what is shown? */
  readonly more: { readonly up: boolean; readonly down: boolean };
}

/** Every excerpt of one book, under the header the list renders. */
export interface BookExcerpts {
  readonly bookId: BookId;
  /** What the book is called: `BookText.label` of the whole book. */
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
  /**
   * What a person reads for a place in this book — `Philemon 1:4`, and for
   * `bookAddress` the book's own name. The caller's, because which name a
   * book goes by (the project's, the book's own heading, English) and the
   * word for an introduction are the project's language, not this module's.
   */
  readonly label: (address: Address) => string;
}

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
interface Projection {
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
const project = (analysis: Analysis, from: number, to: number): Projection => {
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
  ranges: readonly { readonly from: number; readonly to: number; readonly source?: number }[],
): readonly Mark[] => {
  const marks: Mark[] = [];
  const { src } = projection;
  for (const range of ranges) {
    const owner = range.source === undefined ? {} : { source: range.source };
    let open = -1;
    for (let index = 0; index < src.length; index += 1) {
      // SAFETY: `index` is inside the typed array's own length.
      const at = src[index]!;
      const inside = at >= range.from && at < range.to;
      if (inside && open < 0) open = index;
      else if (!inside && open >= 0) {
        marks.push({ from: open, to: index, ...owner });
        open = -1;
      }
    }
    if (open >= 0) marks.push({ from: open, to: src.length, ...owner });
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  return marks;
};

// ---------------------------------------------------------------------------
// One site, quoted
// ---------------------------------------------------------------------------

/**
 * A one-line quotation around a span, in three parts so the character in
 * question can be marked in place.
 *
 * `projected` says which text the three parts are cut from, and it is the
 * whole point of the shape:
 *
 *  - `true` — the READING. The span has characters in the projection, and the
 *    quotation is what the page shows, so a flagged comma reads as a comma in
 *    a sentence rather than as a comma between two backslashes.
 *  - `false` — the RAW slice, because the span has no character in the
 *    projection at all: it is inside a marker name, an attribute, or a control
 *    character the reading drops. There is nothing honest to highlight in the
 *    reading, and quoting the neighbouring words would mark the wrong thing.
 *    A caller says so — "in markup" — rather than quietly showing a different
 *    character.
 *
 * Display only, and it never moves an offset: what a "Go" navigates by is the
 * engine's own span, untouched.
 */
export interface Quotation {
  readonly before: string;
  readonly hit: string;
  readonly after: string;
  /** Is this the reading, or the raw USFM? See above. */
  readonly projected: boolean;
}

/** How much text either side of the span a quotation shows. */
export interface QuoteWidth {
  readonly before: number;
  readonly after: number;
}

const QUOTE: QuoteWidth = { before: 26, after: 34 };

/**
 * How much SOURCE to project to be sure of finding `width` characters of
 * reading either side. The projection drops markers, so the source window has
 * to be the wider of the two by a margin that covers a verse's worth of them.
 */
const WINDOW = 240;

const flat = (part: string): string => part.replace(/\s+/g, " ");

const lead = (text: string, truncated: boolean): string => `${truncated ? "…" : ""}${text}`;

/**
 * Quote `[from, to)` of one book, from the reading when the reading has it.
 *
 * The window is projected rather than the whole book because a quotation is
 * thirty characters and a book is a hundred thousand — and because `project`
 * keeps one source offset per output character, the span is found in the
 * result by the same arithmetic `marksFor` does for an excerpt's highlight.
 */
export const quote = (
  analysis: Analysis,
  from: number,
  to: number,
  width: QuoteWidth = QUOTE,
): Quotation => {
  const start = Math.max(0, from - (width.before + WINDOW));
  const end = Math.min(analysis.docLen, to + (width.after + WINDOW));
  const projection = project(analysis, start, end);
  const marks = marksFor(projection, [{ from, to }]);
  const first = marks[0];
  const last = marks[marks.length - 1];

  if (first === undefined || last === undefined) {
    // Markup: no character of the reading came from this span.
    const rawFrom = Math.max(0, from - width.before);
    const rawTo = Math.min(analysis.docLen, to + width.after);
    return {
      before: lead(flat(analysis.text.slice(rawFrom, from)), rawFrom > 0),
      hit: flat(analysis.text.slice(from, to)),
      after: `${flat(analysis.text.slice(to, rawTo))}${rawTo < analysis.docLen ? "…" : ""}`,
      projected: false,
    };
  }

  const text = projection.text;
  const beforeAt = Math.max(0, first.from - width.before);
  const afterTo = Math.min(text.length, last.to + width.after);
  return {
    before: lead(text.slice(beforeAt, first.from), beforeAt > 0 || start > 0),
    hit: text.slice(first.from, last.to),
    after: `${text.slice(last.to, afterTo)}${afterTo < text.length || end < analysis.docLen ? "…" : ""}`,
    projected: true,
  };
};

// ---------------------------------------------------------------------------
// Units: the TOC's steps
// ---------------------------------------------------------------------------

/**
 * How much of the text around its own unit an excerpt shows, in TOC STEPS.
 *
 * A step is one unit of Location's table — a verse, a chapter's head, the
 * introduction — whatever comes next. Not a verse count and not clamped to
 * the chapter: "one more above" is the unit above, and the unit above verse 1
 * is its chapter's head. `chapter` shows the own unit's whole chapter row and
 * ignores the counts, so turning it off returns to where the reader was.
 */
export interface Extent {
  readonly up: number;
  readonly down: number;
  readonly chapter?: boolean;
}

/** One step either side: what a card shows before the reader asks for more. */
const DEFAULT_EXTENT: Extent = { up: 1, down: 1 };

/** The units of one book, and the TOC they came from, computed once per parse. */
interface Units {
  readonly toc: TocView;
  readonly all: readonly TocUnit[];
}

const unitsOf = (analysis: Analysis): Units => {
  const toc = tocViewOf(analysis);
  return { toc, all: tocUnits(toc) };
};

/** `[low, high]` around `own`, by `extent`, inside the book. */
const window = (units: Units, own: number, extent: Extent): { low: number; high: number } => {
  const { all } = units;
  if (extent.chapter === true) {
    const row = all[own]?.row;
    let low = own;
    let high = own;
    while (low > 0 && all[low - 1]?.row === row) low -= 1;
    while (high < all.length - 1 && all[high + 1]?.row === row) high += 1;
    return { low, high };
  }
  return {
    low: Math.max(0, own - Math.max(0, extent.up)),
    high: Math.min(all.length - 1, own + Math.max(0, extent.down)),
  };
};

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const rangesOf = (hit: Occurrence): readonly { from: number; to: number; source: number }[] =>
  hit.pieces !== undefined && hit.pieces.length > 1
    ? hit.pieces.map((piece) => ({ from: piece.from, to: piece.to, source: hit.from }))
    : [{ from: hit.from, to: hit.to, source: hit.from }];

/**
 * An excerpt whose lazy fields live on a PROTOTYPE, not on the object.
 *
 * A class and not an object literal, for one measured reason: six accessors in
 * a literal are six accessors on every instance, and a feed builds one
 * instance per hit. On a 66-book project that is twenty thousand objects, each
 * forced into a slower shape than plain data, to render twenty cards —
 * `buildExcerpt` was 32ms of a 198ms arrival in the production build. Declared
 * once on a prototype, the getters cost nothing per instance and construction
 * is a plain field assignment.
 *
 * `Excerpt`'s contract is unchanged and so is every call site: the fields
 * still read like values, and the ones that need the projection still cost
 * nothing until something reads them.
 */
class LazyExcerpt implements Excerpt {
  readonly bookId: BookId;
  readonly sid: string;
  readonly address: Address;
  readonly span: { readonly from: number; readonly to: number };
  readonly own: { readonly from: number; readonly to: number };
  readonly hits: readonly Occurrence[];
  readonly extent: Extent;

  /** Set on first read of `marks`. */
  private held: readonly Mark[] | undefined;

  constructor(
    private readonly book: BookText,
    private readonly units: Units,
    private readonly low: number,
    private readonly high: number,
    own: TocUnit,
    hits: readonly Occurrence[],
    address: Address,
    extent: Extent,
  ) {
    this.bookId = book.bookId;
    this.sid = addressCode(address);
    this.address = address;
    const from = units.all[low]?.from ?? own.from;
    this.span = {
      from,
      to: Math.max(own.from, readingEnd(book.analysis, from, units.all[high]?.to ?? own.to)),
    };
    this.own = { from: own.from, to: own.to };
    this.hits = hits;
    this.extent = extent;
  }

  get analysis(): Analysis {
    return this.book.analysis;
  }

  /** Built on read rather than stored: a card asks once, and a string is cheaper than a field. */
  get label(): string {
    return this.book.label(this.address);
  }

  get source(): string {
    return this.book.analysis.text.slice(this.span.from, this.span.to);
  }

  get marks(): readonly Mark[] {
    if (this.held !== undefined) return this.held;
    const projection = project(this.book.analysis, this.span.from, this.span.to);
    this.held = marksFor(projection, this.hits.flatMap(rangesOf));
    return this.held;
  }

  get shown(): { readonly first: Address; readonly last: Address } {
    const name = (index: number): Address => {
      const unit = this.units.all[index];
      return unit === undefined ? this.address : unitAddress(this.bookId, this.units.toc, unit);
    };
    return { first: name(this.low), last: name(this.high) };
  }

  get more(): { readonly up: boolean; readonly down: boolean } {
    return { up: this.low > 0, down: this.high < this.units.all.length - 1 };
  }
}

/**
 * Where the reading in `[from, to)` ends: the end of its last text token,
 * or `to` when the range has none.
 *
 * A unit's extent is STRUCTURAL — it runs to the next unit's marker — so a
 * verse followed by `\p` and a new verse line owns that bare `\p`, and a
 * view clipped to it ends on an empty paragraph. What a card shows stops at
 * the last thing a reader can read. A backward walk from the end: a handful
 * of tokens, not a pass over the book.
 */
const readingEnd = (analysis: Analysis, from: number, to: number): number => {
  const tokens = analysis.dish.tokens;
  if (to <= from || to > analysis.docLen) return to;
  // The token containing `to - 1`: tokens partition the text.
  let lo = 0;
  let hi = tokens.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tokens.at(mid).span().from <= to - 1) {
      last = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  for (let index = last; index >= 0; index -= 1) {
    const token = tokens.at(index);
    const { to: end } = token.span();
    if (end <= from) break;
    if ((token.kind() & ~TOKEN_SPELLING_BIT) === TOKEN.TEXT && !token.isBlank())
      return Math.min(end, to);
  }
  return to;
};

/**
 * One excerpt: the unit at `own`, `extent` steps either side, and every
 * occurrence it owns.
 *
 * `excerptsOf`, `extend` and `pairedExcerpt` all come through here, so a card
 * the reader has expanded — and the paired resource beside it — is built by
 * exactly the same arithmetic as the card they started with.
 */
const buildExcerpt = (
  book: BookText,
  units: Units,
  own: number,
  held: readonly Occurrence[],
  extent: Extent,
  range: { low: number; high: number } = window(units, own, extent),
): Excerpt | undefined => {
  const unit = units.all[own];
  if (unit === undefined) return undefined;
  const address = unitAddress(book.bookId, units.toc, unit);
  return new LazyExcerpt(book, units, range.low, range.high, unit, held, address, extent);
};

/**
 * The excerpts of one book: one per TOC unit that holds at least one
 * occurrence, in document order, each carrying every occurrence inside it.
 *
 * Units tile the text, so every occurrence has one — a match in front matter
 * or a chapter's head is a card under that place, never dropped: a match the
 * reader can see is a match the list must show.
 */
const excerptsOf = (
  book: BookText,
  hits: readonly Occurrence[],
  extent: Extent,
): readonly Excerpt[] => {
  if (hits.length === 0) return [];
  const units = unitsOf(book.analysis);

  // Unit index → the hits it owns, in the order they arrived, which is offset
  // order for both feeds.
  const grouped = new Map<number, Occurrence[]>();
  const order: number[] = [];
  for (const hit of [...hits].sort((a, b) => a.from - b.from)) {
    const index = unitIndexAt(units.all, hit.from);
    const held = grouped.get(index);
    if (held === undefined) {
      grouped.set(index, [hit]);
      order.push(index);
    } else held.push(hit);
  }

  const out: Excerpt[] = [];
  for (const index of order) {
    const built = buildExcerpt(book, units, index, grouped.get(index) ?? [], extent);
    if (built !== undefined) out.push(built);
  }
  return out;
};

/**
 * The same excerpt, showing `extent` around its own unit.
 *
 * Rebuilt from the unit rather than grown from the span it has, so expanding
 * is idempotent in the extent: the card holds "two up, one down", not a span
 * it has been nudging.
 */
export const extend = (book: BookText, excerpt: Excerpt, extent: Extent): Excerpt => {
  const units = unitsOf(book.analysis);
  const own = unitIndexAt(units.all, excerpt.own.from);
  return buildExcerpt(book, units, own, excerpt.hits, extent) ?? excerpt;
};

/** The unit a resolved Address starts in, or ends in. */
const endOf = (units: Units, address: Address, side: "first" | "last"): number | undefined => {
  const found = resolve(units.toc, address);
  if (found.kind !== "found") return undefined;
  // A verse's span is its own; a chapter or the introduction resolves to the
  // whole row, and the unit that NAMED it is the row's first — its head.
  const at = side === "last" && address.kind === "verses" ? found.to - 1 : found.from;
  const index = unitIndexAt(units.all, at);
  return index < 0 ? undefined : index;
};

/**
 * The same place in a PAIRED RESOURCE: `target`'s range, found by Address in
 * another text.
 *
 * The lock is by Address, never by step count: two texts of one book do not
 * share a table of contents (one has a heading where the other has none), so
 * "two steps up" in each would drift apart. What they share is the place.
 *
 * `hits` are the paired resource's own occurrences, when the match is on this
 * side (Find over a reference); the own unit is the first hit's, and
 * otherwise the target's Address found here. `collapsed` shows the own unit
 * alone. An end of the range this text does not have falls back to the own
 * unit rather than guessing a neighbour; an own place it does not have is
 * `undefined`, which the card says in words.
 */
export const pairedExcerpt = (
  book: BookText,
  target: Excerpt,
  hits: readonly Occurrence[],
  collapsed: boolean,
): Excerpt | undefined => {
  const units = unitsOf(book.analysis);
  const first = hits[0];
  const own =
    first === undefined
      ? endOf(units, target.address, "first")
      : unitIndexAt(units.all, first.from);
  if (own === undefined || own < 0) return undefined;
  if (collapsed)
    return buildExcerpt(book, units, own, hits, target.extent, { low: own, high: own });
  if (target.extent.chapter === true) return buildExcerpt(book, units, own, hits, target.extent);
  const shown = target.shown;
  const low = Math.min(own, endOf(units, shown.first, "first") ?? own);
  const high = Math.max(own, endOf(units, shown.last, "last") ?? own);
  return buildExcerpt(book, units, own, hits, target.extent, { low, high });
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
  extent: Extent = DEFAULT_EXTENT,
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
    const excerpts = excerptsOf(book, held, extent);
    if (excerpts.length === 0) continue;
    groups.push({
      bookId: book.bookId,
      name: book.label(bookAddress(book.bookId)),
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

// ---------------------------------------------------------------------------
// References, as a feed
// ---------------------------------------------------------------------------

/**
 * A reference feed's hits: one ZERO-WIDTH occurrence at each verse of
 * `addresses` that this book actually has, in document order.
 *
 * Zero width is the honest span. A search hit knows which characters matched;
 * a reference does not — the guide's highlight offsets index into the guide's
 * OWN frozen reading, not into this project's wording, which may put the term
 * somewhere else in the verse or not use it at all. So the target card is
 * drawn with no highlight and the paired resource carries the guide's, and
 * the context either side of the own unit is still dimmed.
 *
 * WHERE each one is, is Location's `resolve` over the book's TOC: `JUD 1:2`
 * is found inside a `\v 1-2` the project happens to have, and missing from a
 * `\v 1,3`. The occurrence sits where the found span starts, which is a verse
 * anchor — the one `group` then files the card under.
 *
 * Only verse Addresses are fed here, and only this book's. What `resolve`
 * cannot place is skipped rather than reported — missing, or ambiguous in
 * malformed text, where guessing an anchor would put the card on the wrong
 * verse: a guide covers the whole canon and a project covers a few books, and
 * every reference outside them is expected, not a failure. Two references
 * landing on one anchor — both verses of a bridge — become one occurrence,
 * because they are one card.
 */
export const refOccurrences = (
  book: BookText,
  addresses: readonly Address[],
): readonly Occurrence[] => {
  const toc = tocViewOf(book.analysis);
  const found = new Set<number>();
  for (const address of addresses) {
    if (address.kind !== "verses" || address.book !== book.bookId) continue;
    const resolved = resolve(toc, address);
    if (resolved.kind === "found") found.add(resolved.from);
  }
  return [...found]
    .sort((left, right) => left - right)
    .map((at) => ({ bookId: book.bookId, from: at, to: at }));
};
