import type { BookId } from "@sefer/text/book";
import { addressCode, bookAddress, type Address } from "@sefer/text/location/address";
import {
  resolve,
  tocUnits,
  unitAddress,
  unitIndexAt,
  type TocUnit,
  type TocView,
} from "@sefer/text/location/locate";

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

/** One match inside an excerpt, in the book's SOURCE coordinates. */
export interface Occurrence {
  readonly bookId: BookId;
  readonly from: number;
  readonly to: number;
  readonly pieces?: readonly { readonly from: number; readonly to: number }[];
}

export interface Mark {
  readonly from: number;
  readonly to: number;
  readonly source?: number;
}

export interface Excerpt {
  readonly bookId: BookId;
  readonly sid: string;
  readonly address: Address;
  readonly label: string;
  readonly span: { readonly from: number; readonly to: number };
  /** The own unit alone, in source coordinates. The rest of `span` is context. */
  readonly own: { readonly from: number; readonly to: number };
  readonly hits: readonly Occurrence[];
  readonly analysis: Analysis;
  readonly source: string;
  readonly marks: readonly Mark[];
  readonly extent: Extent;
  readonly shown: { readonly first: Address; readonly last: Address };
  readonly more: { readonly up: boolean; readonly down: boolean };
}

export interface BookExcerpts {
  readonly bookId: BookId;
  readonly name: string;
  readonly excerpts: readonly Excerpt[];
  readonly count: number;
}

export interface OutlineRow {
  readonly bookId: BookId;
  readonly name: string;
  readonly count: number;
}

export interface BookText {
  readonly bookId: BookId;
  readonly text: string;
  readonly analysis: Analysis;
  readonly label: (address: Address) => string;
}

interface Projection {
  readonly text: string;
  readonly src: Int32Array;
}

const isSpace = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 13;

const project = (analysis: Analysis, from: number, to: number): Projection => {
  const out: number[] = [];
  const map: number[] = [];
  let note = 0;
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

  let text = "";
  for (let at = 0; at < out.length; at += 4096)
    text += String.fromCharCode(...out.slice(at, at + 4096));

  return { text, src: Int32Array.from(map) };
};

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

export interface Quotation {
  readonly before: string;
  readonly hit: string;
  readonly after: string;
  readonly projected: boolean;
}

export interface QuoteWidth {
  readonly before: number;
  readonly after: number;
}

const QUOTE: QuoteWidth = { before: 26, after: 34 };

const WINDOW = 240;

const flat = (part: string): string => part.replace(/\s+/g, " ");

const lead = (text: string, truncated: boolean): string => `${truncated ? "…" : ""}${text}`;

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

export interface Extent {
  readonly up: number;
  readonly down: number;
  readonly chapter?: boolean;
  readonly folded?: Extent;
}

const DEFAULT_EXTENT: Extent = { up: 1, down: 1 };

interface Units {
  readonly toc: TocView;
  readonly all: readonly TocUnit[];
}

const unitsOf = (analysis: Analysis): Units => {
  const toc = tocViewOf(analysis);
  return { toc, all: tocUnits(toc) };
};

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
export const withoutHits = (excerpt: Excerpt): Excerpt =>
  // SAFETY: `Object.create(excerpt)` inherits every field and getter of `excerpt`; the one own property it defines, `hits`, has Excerpt's type.
  Object.create(excerpt, { hits: { value: [], enumerable: true } }) as Excerpt;

class LazyExcerpt implements Excerpt {
  readonly bookId: BookId;
  readonly sid: string;
  readonly address: Address;
  readonly span: { readonly from: number; readonly to: number };
  readonly own: { readonly from: number; readonly to: number };
  readonly hits: readonly Occurrence[];
  readonly extent: Extent;

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

export const readingEnd = (analysis: Analysis, from: number, to: number): number => {
  const tokens = analysis.dish.tokens;
  if (to <= from || to > analysis.docLen) return to;
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

const excerptsOf = (
  book: BookText,
  hits: readonly Occurrence[],
  extent: Extent,
): readonly Excerpt[] => {
  if (hits.length === 0) return [];
  const units = unitsOf(book.analysis);

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

export const extend = (book: BookText, excerpt: Excerpt, extent: Extent): Excerpt => {
  const units = unitsOf(book.analysis);
  const own = unitIndexAt(units.all, excerpt.own.from);
  return buildExcerpt(book, units, own, excerpt.hits, extent) ?? excerpt;
};

const endOf = (units: Units, address: Address, side: "first" | "last"): number | undefined => {
  const found = resolve(units.toc, address);
  if (found.kind !== "found") return undefined;
  const at = side === "last" && address.kind === "verses" ? found.to - 1 : found.from;
  const index = unitIndexAt(units.all, at);
  return index < 0 ? undefined : index;
};

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
