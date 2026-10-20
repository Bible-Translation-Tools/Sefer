import type { BookId } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";

import {
  OUTER_CLASSES,
  PATTERN_DIGIT_GLYPH,
  type CasingForm,
  type Channel,
  type Cluster,
  type ConventionReason,
  type EngineStamp,
  type FindingsSnapshot,
  type OuterClass,
  type Pattern,
  type PatternKey,
  type Pool,
  type Usual,
} from "../galley";

const WORD_CHANNELS: ReadonlySet<Channel> = new Set<Channel>(["Casing", "WordLength", "Doubled"]);

export interface PatternRow {
  readonly pattern: number;
  readonly channel: Channel;
  readonly key: PatternKey;
  readonly label: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly shareBp: number;
  readonly books: number;
  readonly band: number | null;
  readonly usual: string | undefined;
  readonly clusters: readonly Cluster[];
  readonly flagged: number;
}

export interface PlacementCell {
  readonly class: OuterClass;
  readonly prev: PatternRow | undefined;
  readonly next: PatternRow | undefined;
}

export interface FlaggedSite {
  readonly bookId: BookId;
  readonly from: number;
  readonly to: number;
  readonly reasons: readonly ConventionReason[];
  readonly pattern: number;
  readonly stamp: SourceStamp;
  readonly engine: EngineStamp;
}

export interface Glyph {
  readonly codePoint: number;
  readonly char: string;
  readonly name: string;
  readonly pool: Pool;
  readonly sites: number;
  readonly books: number;
  readonly neighbours: readonly PatternRow[];
  readonly placement: readonly PlacementCell[];
  readonly runShape: readonly PatternRow[];
  readonly other: readonly PatternRow[];
  readonly rows: readonly PatternRow[];
  readonly flagged: readonly FlaggedSite[];
}

export interface Inventory {
  readonly glyphs: readonly Glyph[];
  readonly wordPatterns: readonly PatternRow[];
  readonly bookCount: number;
  readonly patternCount: number;
  readonly flaggedSites: number;
}

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

export const codePointLabel = (codePoint: number): string =>
  codePoint === PATTERN_DIGIT_GLYPH
    ? "digits"
    : `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

const glyphName = (codePoint: number): string => {
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

const QUOTES = "\"'«»‹›‘’‚‛“”„‟「」『』";
const BRACKETS = "()[]{}⁅⁆〈〉〈〉《》【】（）";
const DASHES = "-‐‑‒–—―−֊᐀゠";
const TERMINALS = ".!?…؟۔։。！．？।॥";
const SEPARATORS = ",;:·،؛、，：；⁄/";

const poolOf = (codePoint: number): Pool => {
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

const labelOf = (key: PatternKey, bookKey: (index: number) => string): string => {
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
    case "BookRate":
      return `${key.side === "prev" ? "after" : "before"} ${CLASS_NAMES[key.class]} in ${bookKey(key.book)}`;
  }
};

const CLASS_NAMES: Record<OuterClass, string> = {
  Letter: "a letter",
  Space: "a space",
  Digit: "a digit",
  Nonletter: "a punctuation mark",
  Edge: "the edge of the text",
};

const FORM_NAMES: Record<CasingForm, string> = {
  Lower: "lowercase",
  Title: "capitalized",
  Upper: "in capitals",
  Mixed: "in mixed case",
  Uncased: "uncased",
};

const count = (n: number): string => n.toLocaleString("en");

const quoted = (glyph: number): string =>
  glyph === PATTERN_DIGIT_GLYPH ? "a digit" : `“${String.fromCodePoint(glyph)}”`;

const usualOf = (key: PatternKey, usual: Usual): string | undefined => {
  switch (usual.kind) {
    case "None":
      return undefined;
    case "Placement":
      return key.kind === "Placement" && key.side === "next"
        ? `usually before ${CLASS_NAMES[usual.class]} (${count(usual.count)})`
        : `usually after ${CLASS_NAMES[usual.class]} (${count(usual.count)})`;
    case "ExactNeighbor":
      return `usually followed by ${quoted(usual.neighbor)} (${count(usual.count)})`;
    case "RunShape":
      return usual.bucket <= 1
        ? `usually alone (${count(usual.count)})`
        : `usually in a ${usual.pure ? "run" : "mixed group"} of ${usual.bucket} (${count(usual.count)})`;
    case "Rarity":
      return usual.glyph === null
        ? undefined
        : `most common of its kind: ${quoted(usual.glyph)} (${count(usual.count)})`;
    case "Casing":
      return `usually ${FORM_NAMES[usual.form]} (${count(usual.count)})`;
    case "BookRate":
      return `${(usual.baselineBp / 100).toLocaleString("en", { maximumFractionDigits: 1 })}% in the other ${count(usual.otherBooks)} books`;
  }
};

const rowOf = (
  pattern: Pattern,
  index: number,
  flagged: number,
  bookKey: (index: number) => string,
): PatternRow => ({
  pattern: index,
  channel: pattern.channel,
  key: pattern.key,
  label: labelOf(pattern.key, bookKey),
  numerator: pattern.numerator,
  denominator: pattern.denominator,
  shareBp: pattern.shareBp,
  books: pattern.books,
  band: pattern.band,
  usual: usualOf(pattern.key, pattern.usual),
  clusters: pattern.clusters ?? [],
  flagged,
});

const byWeight = (a: PatternRow, b: PatternRow): number =>
  b.shareBp - a.shareBp || b.numerator - a.numerator || a.pattern - b.pattern;

interface Bucket {
  readonly rows: PatternRow[];
  readonly flagged: FlaggedSite[];
}

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
  const bookKey = (index: number): string => snapshot.book(index)?.key ?? String(index + 1);

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

  const buckets = new Map<number, Bucket>();
  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index];
    const sites = hits.get(index) ?? [];
    const row = rowOf(pattern, index, sites.length, bookKey);
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
          row.channel === "SentenceStart" ||
          row.channel === "BookRate",
      )
      .sort(byWeight);
    let sites = 0;
    let books = 0;
    for (const row of bucket.rows) {
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

export const EMPTY: Inventory = {
  glyphs: [],
  wordPatterns: [],
  bookCount: 0,
  patternCount: 0,
  flaggedSites: 0,
};
