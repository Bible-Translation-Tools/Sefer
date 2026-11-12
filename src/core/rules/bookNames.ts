import type { Change } from "@wycliffeassociates/sefer-text/source";

import {
  Category,
  MarkerKind,
  MARKERS,
  TOKEN,
  TOKEN_SPELLING_BIT,
  TokenView,
  type Analysis,
} from "../galley";
import type { ProjectMetadata } from "../resources/projectMetadata";

/**
 * A book's names, read off its parse, and the edits the Book names dialog
 * makes (RFC "Book names", 2026-11-12). The USFM is the truth; the project's
 * manifest follows it, so the one name both sides are compared on is
 * `shortNameOf`: `\toc2`, else `\h`, never `\toc1`.
 *
 * The header is every line before the first `\c` whose marker the marker
 * table files under identification (`\h \ide \rem \sts \toc \toca`),
 * document structure (`\id \usfm`), or a title row (`\mt \mte`, and a
 * registered `\z` title), plus a marker the table does not know, so a stray
 * one can be taken out. Introductions, `\cl` (Chapter labels owns it),
 * section heads and paragraphs are left to the editor.
 */

export interface HeaderLine {
  /**
   * Which line this is in its book: its key, and `#2`, `#3` for a key that
   * repeats (`\rem`). Stable across parses of the same header, so a dialog's
   * edits find their line again at the press.
   */
  readonly id: string;
  /** What the name is, for its label: `toc2`, `mt1` (a bare `\mt` too), `h`; a `\z` marker's spelling. */
  readonly key: string;
  /** The marker as written, without the backslash: `toc2`, `mt`, `zheader`. */
  readonly spelling: string;
  /** `\id`, `\usfm` and `\ide` say what the file is, not what the book is called. */
  readonly fixed: boolean;
  /** A marker the table does not know (or a registered `\z` one): labelled by its spelling. */
  readonly unknown: boolean;
  /** The words after the marker, trimmed. */
  readonly value: string;
  /** The whole line, the marker to its end, without the line break. */
  readonly from: number;
  readonly to: number;
  /** Past the line break, where there is one: taking `from`–`lineEnd` takes the line. */
  readonly lineEnd: number;
  readonly valueFrom: number;
  readonly valueTo: number;
}

export interface BookHeader {
  readonly lines: readonly HeaderLine[];
  /** The `\c` that ends the header; the text's end when the book has none. */
  readonly end: number;
}

/** Keys that can be added to a book that lacks them, in the order they are written. */
const ADDABLE_KEYS = ["h", "toc1", "toc2", "toc3", "mt1"] as const;
export type AddableKey = (typeof ADDABLE_KEYS)[number];

/** Where a header's lines go, so an added one lands among them, not after the title. */
const ORDER = ["id", "usfm", "ide", "h", "toc1", "toc2", "toc3", "mt1"];

/** What an added key is written as. */
const SPELLING: Record<AddableKey, string> = {
  h: "h",
  toc1: "toc1",
  toc2: "toc2",
  toc3: "toc3",
  mt1: "mt",
};

const FIXED = new Set(["id", "usfm", "ide"]);
const TITLE_ROWS = new Set(["mt", "mte", "ztitle"]);

/** Whether a marker table row belongs in the header. */
const inHeader = (index: number): boolean => {
  if (index === 0) return true;
  const row = MARKERS[index];
  if (row === undefined) return false;
  if (row.category === Category.ParaIdentification) return true;
  if (row.category === Category.DocumentStructure) return true;
  return row.category === Category.ParaTitlesSections && TITLE_ROWS.has(row.name);
};

/** A row's key: its name and level, a numbered row's bare spelling counted as level 1. */
const keyOf = (index: number, level: number, spelling: string): string => {
  const row = MARKERS[index];
  if (index === 0 || row === undefined || row.name.startsWith("z")) return spelling;
  if (row.numbering === 0) return row.name;
  // `\h1` is the old spelling of `\h`; `\h2`, `\h3` are other running heads.
  if (row.name === "h") return level <= 1 ? "h" : `h${String(level)}`;
  return `${row.name}${String(Math.max(1, level))}`;
};

const seen = new WeakMap<Analysis["dish"], BookHeader>();

/** The lines a book names itself with, in order, kept with its parse. */
export const headerOf = (analysis: Analysis): BookHeader => {
  const held = seen.get(analysis.dish);
  if (held !== undefined) return held;
  const text = analysis.text;
  const rows = analysis.dish.tokens.rows;
  const lines: HeaderLine[] = [];
  const counts = new Map<string, number>();
  let end = text.length;
  for (let i = 0, n = rows.length; i < n; i++) {
    const token = rows.seek(i);
    if ((token.kind & ~TOKEN_SPELLING_BIT) !== TOKEN.MARKER) continue;
    const index = token.marker;
    const level = token.level;
    const from = token.start;
    const markerEnd = token.end;
    const row = MARKERS[index];
    if (row?.kind === MarkerKind.Chapter) {
      end = from;
      break;
    }
    if (!inHeader(index)) continue;
    // A marker the table does not know counts only where it starts a line: inside one it is text's.
    if (index === 0 && from > 0 && text[from - 1] !== "\n") continue;
    const spelling = new TokenView(rows, i).spelling(text);
    const key = keyOf(index, level, spelling);
    const lineBreak = text.indexOf("\n", markerEnd);
    const to = lineBreak < 0 ? text.length : lineBreak;
    const raw = text.slice(markerEnd, to);
    const valueFrom = markerEnd + (raw.length - raw.trimStart().length);
    const valueTo = Math.max(valueFrom, to - (raw.length - raw.trimEnd().length));
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    lines.push({
      id: count === 1 ? key : `${key}#${String(count)}`,
      key,
      spelling,
      fixed: FIXED.has(key),
      unknown: index === 0 || (row?.name.startsWith("z") ?? false),
      value: text.slice(valueFrom, valueTo),
      from,
      to,
      lineEnd: lineBreak < 0 ? to : to + 1,
      valueFrom,
      valueTo,
    });
  }
  const header: BookHeader = { lines, end };
  seen.set(analysis.dish, header);
  return header;
};

const valueOf = (header: BookHeader, key: string): string | undefined => {
  const value = header.lines
    .find((line) => line.key === key)
    ?.value.replace(/\s+/g, " ")
    .trim();
  return value === undefined || value === "" ? undefined : value;
};

/**
 * The book's short name: `\toc2`, else `\h`, never `\toc1`. The one function
 * both the manifest's name and the check against it use, so a book renamed
 * from it is never flagged for it.
 */
export const shortNameOf = (header: BookHeader): string | undefined =>
  valueOf(header, "toc2") ?? valueOf(header, "h");

/** The long name and abbreviation, for a Burrito's `long` and `abbr`. */
const longNameOf = (header: BookHeader): string | undefined => valueOf(header, "toc1");
const abbreviationOf = (header: BookHeader): string | undefined => valueOf(header, "toc3");

/** The three names a manifest keeps for a book: short (`\toc2`, else `\h`), long (`\toc1`), abbreviation (`\toc3`). */
export interface Names {
  readonly short?: string;
  readonly long?: string;
  readonly abbr?: string;
}

export const namesOf = (header: BookHeader): Names => {
  const short = shortNameOf(header);
  const long = longNameOf(header);
  const abbr = abbreviationOf(header);
  return {
    ...(short === undefined ? {} : { short }),
    ...(long === undefined ? {} : { long }),
    ...(abbr === undefined ? {} : { abbr }),
  };
};

/** The addable keys a book has no line for. */
export const missingKeys = (header: BookHeader): readonly AddableKey[] =>
  ADDABLE_KEYS.filter((key) => !header.lines.some((line) => line.key === key));

/**
 * What the dialog asks of one book: each line by `id` to a new value, or
 * `null` to take it out, and each missing key to the value it is added with.
 * A line not named is left as it is.
 */
export interface HeaderEdit {
  readonly set: ReadonlyMap<string, string | null>;
  readonly add: ReadonlyMap<AddableKey, string>;
}

/** Whether a value handed across a command boundary is a `HeaderEdit`. */
export const isHeaderEdit = (value: unknown): value is HeaderEdit =>
  typeof value === "object" &&
  value !== null &&
  "set" in value &&
  value.set instanceof Map &&
  "add" in value &&
  value.add instanceof Map;

/** One line's words cleaned for a header line: no line breaks, no backslashes. */
const clean = (value: string): string => value.replace(/[\\\r\n]+/g, " ").trim();

/**
 * The changes that make a book's header what `edit` asks. A line set to an
 * empty value is taken out; an added key goes after the last line that comes
 * before it in the usual order (`\id \usfm \ide \h \toc1-3 \mt`), else before
 * the header's first line. Read-only lines (`\id \usfm \ide`) are never touched.
 */
export const headerChanges = (
  header: BookHeader,
  text: string,
  edit: HeaderEdit,
): readonly Change[] => {
  const changes: Change[] = [];
  for (const line of header.lines) {
    if (line.fixed || !edit.set.has(line.id)) continue;
    const wanted = edit.set.get(line.id);
    const value = wanted === null || wanted === undefined ? "" : clean(wanted);
    if (value === "") changes.push({ from: line.from, to: line.lineEnd, insert: "" });
    else if (value !== line.value)
      changes.push({ from: line.valueFrom, to: line.valueTo, insert: value });
  }

  const inserts = new Map<number, string>();
  for (const key of ADDABLE_KEYS) {
    const value = clean(edit.add.get(key) ?? "");
    if (value === "" || header.lines.some((line) => line.key === key)) continue;
    const rank = ORDER.indexOf(key);
    let after: HeaderLine | undefined;
    for (const line of header.lines) {
      const at = ORDER.indexOf(line.key);
      if (at >= 0 && at < rank) after = line;
    }
    const at = after?.lineEnd ?? header.lines[0]?.from ?? header.end;
    const needsBreak = at > 0 && text[at - 1] !== "\n";
    const written = `${needsBreak ? "\n" : ""}\\${SPELLING[key]} ${value}\n`;
    inserts.set(at, (inserts.get(at) ?? "") + written);
  }
  for (const [at, insert] of inserts) changes.push({ from: at, to: at, insert });

  return changes.sort((a, b) => a.from - b.from || a.to - b.to);
};

/** What the project's manifest calls a book, in the project's own language. */
export interface ManifestName {
  /** The manifest lists the book. */
  readonly listed: boolean;
  /** Its name in the project's language; undefined when it has none there (only English, say). */
  readonly name?: string;
}

/**
 * A book's name in the manifest, in the project language only: a manifest
 * that names a book in English alone has no name for it in the language.
 */
export const manifestNameOf = (
  metadata: ProjectMetadata | undefined,
  bookId: string,
): ManifestName => {
  const names = metadata?.bookNames[bookId] ?? metadata?.bookNames[bookId.toUpperCase()];
  if (names === undefined) return { listed: false };
  const tag = metadata?.language.tag ?? "";
  const base = tag.split("-")[0] ?? "";
  const name = (tag === "" ? undefined : names[tag]) ?? (base === "" ? undefined : names[base]);
  const trimmed = name?.replace(/\s+/g, " ").trim();
  return trimmed === undefined || trimmed === ""
    ? { listed: true }
    : { listed: true, name: trimmed };
};

/**
 * One book whose names need a look: the project list calls it something
 * other than its short name (`manifest`), or it has no short name at all
 * (`missing`), so the project list has nothing to follow.
 */
export interface NameMark {
  readonly bookId: string;
  readonly reason: "manifest" | "missing";
  /** The line the mark sits on: the short name's, else the header's first. */
  readonly line?: HeaderLine;
  readonly short?: string;
  /** What the manifest calls it in the language; "" when it has no name there. */
  readonly listed?: string;
  readonly keys: { readonly here: string };
}

export interface NameJudgement {
  readonly marks: ReadonlyMap<string, readonly NameMark[]>;
  readonly manifest: number;
  readonly missing: number;
}

/** Turning the whole check off: the summary's own key. */
export const BOOK_NAMES_OFF = "project:bookNames";

export const judgeNames = (
  books: ReadonlyMap<string, BookHeader>,
  manifest: (bookId: string) => ManifestName,
  quiet: (keys: NameMark["keys"]) => boolean,
): NameJudgement => {
  const marks = new Map<string, NameMark[]>();
  let differ = 0;
  let missing = 0;
  for (const [bookId, header] of books) {
    const short = shortNameOf(header);
    const anchor =
      header.lines.find((line) => line.key === "toc2" && line.value !== "") ??
      header.lines.find((line) => line.key === "h" && line.value !== "") ??
      header.lines[0];
    let mark: NameMark | undefined;
    if (short === undefined) {
      mark = {
        bookId,
        reason: "missing",
        ...(anchor === undefined ? {} : { line: anchor }),
        keys: { here: `project:bookName:${bookId}:missing` },
      };
    } else {
      const listed = manifest(bookId);
      if (listed.listed && listed.name !== short)
        mark = {
          bookId,
          reason: "manifest",
          ...(anchor === undefined ? {} : { line: anchor }),
          short,
          listed: listed.name ?? "",
          keys: { here: `project:bookName:${bookId}:manifest` },
        };
    }
    if (mark === undefined || quiet(mark.keys)) continue;
    marks.set(bookId, [mark]);
    if (mark.reason === "missing") missing += 1;
    else differ += 1;
  }
  return { marks, manifest: differ, missing };
};
