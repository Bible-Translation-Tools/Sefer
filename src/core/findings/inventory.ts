// inventory.ts
//
// The character inventory: how this translation actually uses its punctuation,
// its digits and its symbols, and what the engine flagged.
//
// Sous already measures every one of these things — it has to, because a
// convention finding is a claim about a corpus and a claim needs a
// denominator. What it publishes is a flat PATTERN TABLE: one row per
// (glyph, channel, key) with a numerator, a denominator, a share in basis
// points and a book count. `fromSnapshot` reads that table only to phrase a
// finding's message. This file reads it as the thing it actually is — a
// description of the corpus — and pivots it into one record per code point.
//
// Three decisions shape the file.
//
//  1. THE TABLE IS NOT A CENSUS. Sous emits a pattern row when a channel had
//     something to say about a glyph, not for every character in the project.
//     So "occurrences" here is a proxy (see `sites`), the inventory covers the
//     glyphs the engine measured, and the page says so rather than implying it
//     counted the text. Counting characters is a different pass and would need
//     the text, which this module deliberately does not take.
//
//  2. WORD CHANNELS ARE NOT GLYPHS. `Casing`, `WordLength` and `Doubled` judge
//     a word, carry a hash instead of a scalar, and read `glyph === 0` off the
//     wire. Folding them into a "code point zero" row would invent a character.
//     They are kept aside in `wordPatterns`, unaggregated, so nothing is lost
//     and nothing is misfiled.
//
//  3. A PATTERN INDEX IS NOT DURABLE. Rows are numbered by the publication
//     that produced them and the next publication renumbers everything, so a
//     pattern index is only ever used against the snapshot it came from — the
//     one `ProjectAnalysis` still holds. That is why `inventory()` is computed
//     from a snapshot and memoised beside `findings()`, and never stored.
//
// Pure: no Effect, no Solid, no host. It takes the snapshot and a resolver and
// returns plain values, exactly as `filter.ts` does for the panel.

import type { BookId, Ref } from "../book/book";
import {
  OUTER_CLASSES,
  PATTERN_DIGIT_GLYPH,
  type Analysis,
  type Channel,
  type ConventionReason,
  type EngineStamp,
  type FindingsSnapshot,
  type OuterClass,
  type Pattern,
  type PatternKey,
  type Pool,
} from "../galley";
import type { SourceStamp } from "../source/source";

/** The word channels: they judge a word, not a scalar, and carry a hash. */
const WORD_CHANNELS: ReadonlySet<Channel> = new Set<Channel>(["Casing", "WordLength", "Doubled"]);

/**
 * One row of the publication's pattern table, in the vocabulary a reader wants:
 * the numbers as they were published, plus a label for the key and a count of
 * the convention findings that point at this row.
 */
export interface PatternRow {
  /** Position in THIS snapshot's pattern table. Not durable — see the header. */
  readonly pattern: number;
  readonly channel: Channel;
  readonly key: PatternKey;
  /** The key as a short phrase: `“`, `Quote`, `Letter`, `pure ×3`, `run of 4`. */
  readonly label: string;
  readonly numerator: number;
  readonly denominator: number;
  /** Basis points: 2500 is 25.00%. */
  readonly shareBp: number;
  /** Books holding part of the numerator, out of the snapshot's book count. */
  readonly books: number;
  /** Staircase step, `null` on `Rarity`. */
  readonly band: number | null;
  /** Convention findings in this publication whose `pattern` is this row. */
  readonly flagged: number;
}

/** One outer class, with the row for each side that had one. */
export interface PlacementCell {
  readonly class: OuterClass;
  readonly prev: PatternRow | undefined;
  readonly next: PatternRow | undefined;
}

/**
 * A site the engine convicted, with enough to navigate to it, to explain it,
 * and to know whether it is still true.
 *
 * It carries both stamps for the same reason a `Finding` does: `stamp` is the
 * Book's revision, which decides whether a "Go" would land where the engine
 * looked, and `engine` is the hash the table of contents must match before an
 * offset may be turned into a chapter and verse. A site without them could be
 * shown but never trusted.
 */
export interface FlaggedSite {
  readonly bookId: BookId;
  readonly from: number;
  readonly to: number;
  /** Every rung the site matched, not only the channel that owns the pattern. */
  readonly reasons: readonly ConventionReason[];
  readonly pattern: number;
  readonly stamp: SourceStamp;
  readonly engine: EngineStamp;
}

/**
 * Where a flagged site points, as a chapter and verse — when, and only when,
 * the analysis handed over describes the very text the engine measured.
 *
 * The same rule as `findings.navigateTarget`, for the same reason: the table
 * of contents is the only route from an offset to a reference, and one from
 * another revision names the wrong verse with total confidence. `undefined`
 * means "show the offset", never "guess".
 */
export const siteRef = (site: FlaggedSite, analysis: Analysis | undefined): Ref | undefined => {
  if (analysis === undefined) return undefined;
  if (analysis.docLen !== site.engine.docLen || analysis.sourceHash !== site.engine.sourceHash)
    return undefined;
  const at = analysis.dish.toc.at(site.from);
  if (at === null) return undefined;
  return { book: site.bookId, chapter: at.chapter, ...(at.verse > 0 ? { verse: at.verse } : {}) };
};

/** Everything the publication said about one code point. */
export interface Glyph {
  /** The scalar, or `PATTERN_DIGIT_GLYPH` for the pooled digit lane. */
  readonly codePoint: number;
  /** The character itself; empty for the pooled digit lane. */
  readonly char: string;
  /** A name for it: a small table, else `U+XXXX`. `digits` for the pool. */
  readonly name: string;
  readonly pool: Pool;
  /**
   * An occurrences PROXY, not a count of the character in the text.
   *
   * Every channel publishes a fraction, and which half of it counts THIS
   * glyph depends on the channel. A neighbour, `Placement` or `RunShape` row
   * is judged against the glyph's own sites, so its DENOMINATOR is the count.
   * `Rarity` is judged against the whole corpus — its denominator is every
   * scalar Sous measured — so its NUMERATOR is the count instead. The largest
   * of those is the closest the table comes to "how often does this character
   * occur".
   *
   * It stays a proxy for two reasons. A glyph the engine measured on only one
   * narrow channel reports that channel's population and nothing wider. And
   * nothing here re-reads the text to check, deliberately: this module is a
   * reader of the publication, not a second measurement of the project.
   */
  readonly sites: number;
  /** The widest book spread any of its channels reported. */
  readonly books: number;
  /** `ExactNeighbor` and `PooledNeighbor` — what sits beside it. */
  readonly neighbours: readonly PatternRow[];
  /** `Placement`, pivoted: one cell per outer class, both sides. */
  readonly placement: readonly PlacementCell[];
  /** `RunShape` — how long a run of it gets, and whether the run is pure. */
  readonly runShape: readonly PatternRow[];
  /** `Rarity`, `LetterRun`, `SentenceStart`. */
  readonly other: readonly PatternRow[];
  /** Every row above, flat, in table order — the id space for a filter. */
  readonly rows: readonly PatternRow[];
  /** The convention findings that named one of those rows. */
  readonly flagged: readonly FlaggedSite[];
}

export interface Inventory {
  /** One per code point the publication measured, most sites first. */
  readonly glyphs: readonly Glyph[];
  /** `Casing`, `WordLength`, `Doubled` — kept, not shown as characters. */
  readonly wordPatterns: readonly PatternRow[];
  /** Books in the publication, the denominator of `Glyph.books`. */
  readonly bookCount: number;
  /** Rows in the pattern table, glyph and word alike. */
  readonly patternCount: number;
  /** Convention sites joined to a glyph. */
  readonly flaggedSites: number;
}

/**
 * Names for the characters this inventory is actually about — the punctuation,
 * the spaces and the marks a translation's convention lives in. Deliberately
 * small: `Intl.DisplayNames` has no Unicode-name mode, the UCD is a megabyte,
 * and `U+2042` is a perfectly honest answer for the long tail.
 */
const NAMES: ReadonlyMap<number, string> = new Map([
  [0x20, "space"],
  [0x21, "exclamation mark"],
  [0x22, "quotation mark"],
  [0x23, "number sign"],
  [0x24, "dollar sign"],
  [0x25, "percent sign"],
  [0x26, "ampersand"],
  [0x27, "apostrophe"],
  [0x28, "left parenthesis"],
  [0x29, "right parenthesis"],
  [0x2a, "asterisk"],
  [0x2b, "plus sign"],
  [0x2c, "comma"],
  [0x2d, "hyphen-minus"],
  [0x2e, "full stop"],
  [0x2f, "solidus"],
  [0x3a, "colon"],
  [0x3b, "semicolon"],
  [0x3c, "less-than sign"],
  [0x3d, "equals sign"],
  [0x3e, "greater-than sign"],
  [0x3f, "question mark"],
  [0x40, "commercial at"],
  [0x5b, "left square bracket"],
  [0x5c, "reverse solidus"],
  [0x5d, "right square bracket"],
  [0x5e, "circumflex accent"],
  [0x5f, "low line"],
  [0x60, "grave accent"],
  [0x7b, "left curly bracket"],
  [0x7c, "vertical line"],
  [0x7d, "right curly bracket"],
  [0x7e, "tilde"],
  [0xa0, "no-break space"],
  [0xab, "left-pointing double angle quotation mark"],
  [0xb7, "middle dot"],
  [0xbb, "right-pointing double angle quotation mark"],
  [0xbf, "inverted question mark"],
  [0x2010, "hyphen"],
  [0x2011, "non-breaking hyphen"],
  [0x2013, "en dash"],
  [0x2014, "em dash"],
  [0x2015, "horizontal bar"],
  [0x2018, "left single quotation mark"],
  [0x2019, "right single quotation mark"],
  [0x201a, "single low-9 quotation mark"],
  [0x201c, "left double quotation mark"],
  [0x201d, "right double quotation mark"],
  [0x201e, "double low-9 quotation mark"],
  [0x2020, "dagger"],
  [0x2021, "double dagger"],
  [0x2022, "bullet"],
  [0x2026, "horizontal ellipsis"],
  [0x2039, "single left-pointing angle quotation mark"],
  [0x203a, "single right-pointing angle quotation mark"],
  [0x2044, "fraction slash"],
  [0x2212, "minus sign"],
  [0x3001, "ideographic comma"],
  [0x3002, "ideographic full stop"],
  [0x300c, "left corner bracket"],
  [0x300d, "right corner bracket"],
  [0xff0c, "fullwidth comma"],
  [0xff0e, "fullwidth full stop"],
  [0xff1a, "fullwidth colon"],
  [0xff1b, "fullwidth semicolon"],
  [0xff1f, "fullwidth question mark"],
  [0x061b, "arabic semicolon"],
  [0x061f, "arabic question mark"],
  [0x060c, "arabic comma"],
  [0x05be, "hebrew punctuation maqaf"],
  [0x05c3, "hebrew punctuation sof pasuq"],
]);

/** `U+0041`, with the width Unicode itself uses. */
export const codePointLabel = (codePoint: number): string =>
  codePoint === PATTERN_DIGIT_GLYPH
    ? "digits"
    : `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * A name for a code point, cheaply. The table above, else the general
 * category as a phrase, else the code point itself. Never a guess that reads
 * like a fact.
 */
export const glyphName = (codePoint: number): string => {
  if (codePoint === PATTERN_DIGIT_GLYPH) return "digits";
  const known = NAMES.get(codePoint);
  if (known !== undefined) return known;
  const char = String.fromCodePoint(codePoint);
  if (/\p{Nd}/u.test(char)) return "digit";
  if (/\p{Lu}/u.test(char)) return "capital letter";
  if (/\p{Ll}/u.test(char)) return "small letter";
  if (/\p{M}/u.test(char)) return "combining mark";
  if (/\p{Zs}/u.test(char)) return "space";
  return codePointLabel(codePoint);
};

/**
 * Which pool a code point belongs to, over the engine's own eight names.
 *
 * A glyph's own `PooledNeighbor` rows classify its NEIGHBOURS, not itself, so
 * the filter needs a classifier rather than a lookup. It is a presentation
 * grouping — it never feeds a number — so a rough call on the long tail costs
 * nothing but a chip.
 */
const QUOTES = "\"'«»‹›‘’‚‛“”„‟「」『』";
const BRACKETS = "()[]{}⁅⁆〈〉〈〉《》【】（）";
const DASHES = "-‐‑‒–—―−֊᐀゠";
const TERMINALS = ".!?…؟۔։。！．？।॥";
const SEPARATORS = ",;:·،؛、，：；⁄/";

export const poolOf = (codePoint: number): Pool => {
  if (codePoint === PATTERN_DIGIT_GLYPH) return "Digit";
  const char = String.fromCodePoint(codePoint);
  if (QUOTES.includes(char)) return "Quote";
  if (BRACKETS.includes(char)) return "Bracket";
  if (DASHES.includes(char)) return "Dash";
  if (TERMINALS.includes(char)) return "Terminal";
  if (SEPARATORS.includes(char)) return "Separator";
  if (/\p{Nd}/u.test(char)) return "Digit";
  if (/[\p{S}\p{P}]/u.test(char)) return "Symbol";
  return "Other";
};

/** The key as a short phrase. One place, so a table and a message agree. */
const labelOf = (key: PatternKey): string => {
  switch (key.kind) {
    case "ExactNeighbor":
      return key.neighbor === PATTERN_DIGIT_GLYPH ? "a digit" : String.fromCodePoint(key.neighbor);
    case "PooledNeighbor":
      return key.pool;
    case "RunShape":
      return `${key.pure ? "pure" : "mixed"} ×${key.bucket}`;
    case "Placement":
      return key.class;
    case "Rarity":
      return "rare in this project";
    case "LetterRun":
      return `run of ${key.length}`;
    case "SentenceStart":
      return "lowercase after it";
    case "Casing":
      return key.form;
    case "WordLength":
      return `σ ${key.sigma}`;
    case "Doubled":
      return key.separated ? "doubled, separated" : "doubled";
  }
};

const rowOf = (pattern: Pattern, index: number, flagged: number): PatternRow => ({
  pattern: index,
  channel: pattern.channel,
  key: pattern.key,
  label: labelOf(pattern.key),
  numerator: pattern.numerator,
  denominator: pattern.denominator,
  shareBp: pattern.shareBp,
  books: pattern.books,
  band: pattern.band,
  flagged,
});

/** Biggest share first, then biggest count: the row a reader wants at the top. */
const byWeight = (a: PatternRow, b: PatternRow): number =>
  b.shareBp - a.shareBp || b.numerator - a.numerator || a.pattern - b.pattern;

interface Bucket {
  readonly rows: PatternRow[];
  readonly flagged: FlaggedSite[];
}

/**
 * The pattern table, pivoted per code point, with the convention findings
 * joined on.
 *
 * `resolveBook` is the SAME resolver `fromSnapshot` takes — a published host
 * id back to the book and the two stamps of the text we published — so
 * `ProjectAnalysis` hands both readers one function and the sites here carry
 * the same freshness answer the findings do. A book the caller no longer holds
 * is skipped rather than guessed at: a site nobody can open is not a site.
 *
 * A publication in UTF-8 coordinates keeps its PATTERNS — a share and a
 * denominator are coordinate-free — but contributes no flagged sites, for the
 * same reason `fromSnapshot` drops one whole: an offset in the wrong space
 * points at the wrong bytes, and a "Go" that lands in the wrong verse is worse
 * than no "Go" at all.
 */
export const inventory = (
  snapshot: FindingsSnapshot,
  resolveBook: (
    id: string,
  ) =>
    | { readonly bookId: BookId; readonly stamp: SourceStamp; readonly engine: EngineStamp }
    | undefined,
): Inventory => {
  const patterns = snapshot.patterns();
  const wordPatterns: PatternRow[] = [];

  // Pass one: how many convention sites name each pattern row, and where they
  // are. Counting first means a row knows its own flagged count when it is
  // built, so nothing has to be patched afterwards.
  const hits = new Map<number, FlaggedSite[]>();
  if (snapshot.coordinateSpace === "utf16") {
    for (let index = 0; index < snapshot.length; index += 1) {
      const book = snapshot.book(index);
      if (book === undefined) continue;
      const resolved = resolveBook(book.id);
      if (resolved === undefined) continue;
      for (let row = 0; row < book.count; row += 1) {
        const finding = book.at(row);
        if (finding.kind !== "Convention") continue;
        const at = finding.convention.pattern;
        const site: FlaggedSite = {
          bookId: resolved.bookId,
          from: finding.from,
          to: finding.to,
          stamp: resolved.stamp,
          engine: resolved.engine,
          reasons: finding.convention.reasons,
          pattern: at,
        };
        const held = hits.get(at);
        if (held === undefined) hits.set(at, [site]);
        else held.push(site);
      }
    }
  }

  // Pass two: the pivot.
  const buckets = new Map<number, Bucket>();
  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index];
    const sites = hits.get(index) ?? [];
    const row = rowOf(pattern, index, sites.length);
    if (WORD_CHANNELS.has(pattern.channel)) {
      wordPatterns.push(row);
      continue;
    }
    let bucket = buckets.get(pattern.glyph);
    if (bucket === undefined) {
      bucket = { rows: [], flagged: [] };
      buckets.set(pattern.glyph, bucket);
    }
    bucket.rows.push(row);
    bucket.flagged.push(...sites);
  }

  const glyphs: Glyph[] = [];
  for (const [codePoint, bucket] of buckets) {
    const neighbours = bucket.rows
      .filter((row) => row.channel === "ExactNeighbor" || row.channel === "PooledNeighbor")
      .sort(byWeight);
    const placementRows = bucket.rows.filter((row) => row.channel === "Placement");
    const placement: PlacementCell[] = [];
    for (const outer of OUTER_CLASSES) {
      const prev = placementRows.find(
        (row) => row.key.kind === "Placement" && row.key.side === "prev" && row.key.class === outer,
      );
      const next = placementRows.find(
        (row) => row.key.kind === "Placement" && row.key.side === "next" && row.key.class === outer,
      );
      if (prev !== undefined || next !== undefined) placement.push({ class: outer, prev, next });
    }
    const runShape = bucket.rows.filter((row) => row.channel === "RunShape").sort(byWeight);
    const other = bucket.rows
      .filter(
        (row) =>
          row.channel === "Rarity" ||
          row.channel === "LetterRun" ||
          row.channel === "SentenceStart",
      )
      .sort(byWeight);
    let sites = 0;
    let books = 0;
    for (const row of bucket.rows) {
      // See `Glyph.sites`: Rarity counts this glyph in its numerator, every
      // other channel counts it in its denominator.
      const counted = row.channel === "Rarity" ? row.numerator : row.denominator;
      if (counted > sites) sites = counted;
      if (row.books > books) books = row.books;
    }
    glyphs.push({
      codePoint,
      char: codePoint === PATTERN_DIGIT_GLYPH ? "" : String.fromCodePoint(codePoint),
      name: glyphName(codePoint),
      pool: poolOf(codePoint),
      sites,
      books,
      neighbours,
      placement,
      runShape,
      other,
      rows: [...bucket.rows].sort((a, b) => a.pattern - b.pattern),
      flagged: bucket.flagged.sort(
        (a, b) => (a.bookId < b.bookId ? -1 : a.bookId > b.bookId ? 1 : 0) || a.from - b.from,
      ),
    });
  }
  // Most-used first, and a flagged glyph ahead of a quiet one at the same size:
  // the top of the table is where the reader starts.
  glyphs.sort(
    (a, b) => b.sites - a.sites || b.flagged.length - a.flagged.length || a.codePoint - b.codePoint,
  );

  let flaggedSites = 0;
  for (const sites of hits.values()) flaggedSites += sites.length;

  return {
    glyphs,
    wordPatterns: wordPatterns.sort(byWeight),
    bookCount: snapshot.length,
    patternCount: patterns.length,
    flaggedSites,
  };
};

/** The empty inventory, for "no publication yet". One value, not a null check. */
export const EMPTY: Inventory = {
  glyphs: [],
  wordPatterns: [],
  bookCount: 0,
  patternCount: 0,
  flaggedSites: 0,
};

/**
 * Every flagged site of one glyph — "the other places this character is
 * underlined". The sites are already grouped on the `Glyph`; this is the door
 * a caller holding only a code point (the editor's lint tooltip, a Findings
 * filter) reaches for, so the grouping rule lives in one place.
 */
export const sitesOfGlyph = (held: Inventory, codePoint: number): readonly FlaggedSite[] =>
  held.glyphs.find((glyph) => glyph.codePoint === codePoint)?.flagged ?? [];
