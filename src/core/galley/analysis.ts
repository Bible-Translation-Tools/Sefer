/**
 * `Analysis` — the one value every consumer of the engine reads, plus the pure
 * helpers that read it.
 *
 * This file is the vocabulary half of the Galley seam. `galley.ts` owns the
 * wasm handle and the single `analyze` call; everything downstream (the
 * editor's fold, findings, fixes, project analysis) imports FROM HERE and
 * never from the engine package. That is why its types are re-exported below:
 * the pinned build is regenerated upstream, and one import site to re-point
 * is the whole cost of moving to a new tag.
 *
 * Nothing here allocates a fiber or touches the wasm wall. These are the
 * functions the keystroke path calls, so they are plain and synchronous.
 */

import { declaredVersion } from "@wycliffeassociates/scripture-kitchen/reader";
import type { Dish, DiagnosticView } from "@wycliffeassociates/scripture-kitchen/reader";
import {
  Category,
  MARKERS,
  MarkerKind,
  TOKEN_SPELLING_BIT,
  TokenKind,
} from "@wycliffeassociates/scripture-kitchen/reader";

// The reader's surface, re-exported so the engine has exactly one importer.
export {
  Category,
  CloseReason,
  DiagnosticView,
  isMarkerKind,
  MARKERS,
  MarkerKind,
  NODE_ID_BIT,
  NodeView,
  NONE,
  SpecContext,
  StructuralWhitespaceRequirement,
  TOKEN_BLANK,
  TOKEN_DELIMITER_FOLDED,
  TOKEN_SPELLING_BIT,
  TokenKind,
  TokenView,
  Tree,
} from "@wycliffeassociates/scripture-kitchen/reader";
export type { Dish } from "@wycliffeassociates/scripture-kitchen/reader";

/**
 * One parse, with everything needed to prove which text it describes.
 *
 * Immutable by contract: consumers hold it across gestures and compare it,
 * they never patch it. `dish` is a set of cursors over a wasm-owned buffer
 * that the reader copied out, so it stays readable for the value's lifetime.
 */
export interface Analysis {
  /** The parse itself: tree, tokens, diagnostics, toc, header facts. */
  readonly dish: Dish;
  /** The exact text handed to the engine. Canonical LF, no `\r`. */
  readonly text: string;
  /** `text.length` in UTF-16 code units — the space every offset is in. */
  readonly docLen: number;
  /** xxh3-64 of the source bytes, from the engine. THE content identity. */
  readonly sourceHash: bigint;
  /** Monotonic per handle. Orders analyses; never identifies text. */
  readonly revision: number;
  /** Wall time inside the wasm call, milliseconds, for the budget note. */
  readonly engineMs: number;
  /** The `\usfm` version the document declares, or `null`. Gates severity. */
  readonly usfmVersion: string | null;
}

/**
 * Does this analysis describe exactly this text? The strict door, for anything
 * that will index into `text` by offset: length first (cheap reject), then the
 * full comparison. Use this, not the hash, when correctness needs certainty
 * over a string you already hold.
 */
export const describesExactly = (analysis: Analysis, text: string): boolean =>
  analysis.docLen === text.length && analysis.text === text;

/**
 * Are two analyses of the same text? Engine hash plus length — parse-to-parse
 * identity without holding either string. Length alone would say yes to the
 * ordinary same-length edit, which is the bug this pair exists to defeat.
 */
export const sameSource = (a: Analysis, b: Analysis): boolean =>
  a.docLen === b.docLen && a.sourceHash === b.sourceHash;

/**
 * The freshness token a derived product carries: enough to prove the text it
 * was computed from, and nothing else. Every finding, fix preview, search hit
 * and save baseline stamps itself with one of these.
 */
export interface EngineStamp {
  readonly docLen: number;
  readonly sourceHash: bigint;
}

export const stampOf = (analysis: Analysis): EngineStamp => ({
  docLen: analysis.docLen,
  sourceHash: analysis.sourceHash,
});

/** Is a stamped product still about the text this analysis describes? */
export const stampMatches = (stamp: EngineStamp, analysis: Analysis): boolean =>
  stamp.docLen === analysis.docLen && stamp.sourceHash === analysis.sourceHash;

/** The declared USFM version of a dish, as `DiagnosticView.severity` wants it. */
export const versionOf = (analysis: Analysis): string | null => declaredVersion(analysis.dish);

/**
 * Canonicalise line endings on ingress. The engine and `Source` both refuse
 * `\r`; this is the one place that rewrites rather than refusing, for text
 * arriving from outside (a paste, a foreign file). `changed` tells the caller
 * it is now holding something different from what it read.
 */
export const toLf = (text: string): { readonly text: string; readonly changed: boolean } => {
  if (!text.includes("\r")) return { text, changed: false };
  return { text: text.replace(/\r\n?/g, "\n"), changed: true };
};

// ---------------------------------------------------------------------------
// Token and marker classification
//
// A "class word" packs what a consumer asks of a marker — its coarse family in
// the low three bits, orthogonal facts above them — into one integer, so the
// editor's per-token pass reads one number instead of resolving a table row
// and branching on `kind`, `category` and spelling separately.
// ---------------------------------------------------------------------------

/** `TokenKind` under the names the editor's tables use. */
export const TOKEN = {
  MARKER: TokenKind.Marker,
  CLOSING_MARKER: TokenKind.ClosingMarker,
  MILESTONE: TokenKind.Milestone,
  MILESTONE_TERMINATOR: TokenKind.MilestoneTerminator,
  NEWLINE: TokenKind.Newline,
  OPT_BREAK: TokenKind.OptBreak,
  ATTR_LIST: TokenKind.AttrList,
  TEXT: TokenKind.Text,
  DESIGNATOR: TokenKind.Designator,
  NOTE_CALLER: TokenKind.NoteCaller,
  BOOK_CODE: TokenKind.BookCode,
  PAD: TokenKind.Pad,
} as const;

/** The coarse family, in the class word's low three bits. */
export const CLASS = {
  OTHER: 0,
  PARA: 1,
  CHAR: 2,
  NOTE: 3,
  MILESTONE: 4,
  CHAPTER_VERSE: 5,
  SIDEBAR: 6,
  TABLE: 7,
} as const;

/** Orthogonal facts, above the family bits. */
export const FLAG = {
  HEADING: 1 << 3,
  FRONT: 1 << 4,
  POETRY: 1 << 5,
  CLOSER: 1 << 6,
  UNKNOWN: 1 << 7,
  META: 1 << 8,
} as const;

/** The family alone. */
export const coarse = (cls: number): number => cls & 0b111;

/** Is one `FLAG` set? */
export const has = (cls: number, flag: number): boolean => (cls & flag) !== 0;

/**
 * The class word for marker table row `idx`, refined by a token's kind bits.
 *
 * `kindBits` is the raw byte — spelling bit included — because the closer and
 * unknown facts are only knowable from it: `\+bd` and `\bd*` resolve to the
 * same row, and only the bits say which one this token is. Pass `null` when
 * classifying a row rather than a token.
 *
 * Row 0 is the unknown marker, so `idx === 0` is what UNKNOWN means.
 */
export const classWordOf = (idx: number, kindBits: number | null): number => {
  const row = MARKERS[idx];
  if (row === undefined) return 0;
  const unknown = idx === 0;
  let word: number = CLASS.OTHER;
  switch (row.kind) {
    case MarkerKind.Paragraph:
    case MarkerKind.Header:
      word = CLASS.PARA;
      break;
    case MarkerKind.Character:
    case MarkerKind.Figure:
      word = CLASS.CHAR;
      break;
    case MarkerKind.Note:
      word = CLASS.NOTE;
      break;
    case MarkerKind.Milestone:
      word = CLASS.MILESTONE;
      break;
    case MarkerKind.Chapter:
    case MarkerKind.Verse:
      word = CLASS.CHAPTER_VERSE;
      break;
    case MarkerKind.Sidebar:
      word = CLASS.SIDEBAR;
      break;
    case MarkerKind.TableRow:
    case MarkerKind.TableCell:
      word = CLASS.TABLE;
      break;
    default:
      word = CLASS.OTHER;
  }
  switch (row.category) {
    case Category.ParaTitlesSections:
      word |= FLAG.HEADING;
      break;
    case Category.ParaIdentification:
    case Category.DocumentStructure:
      word |= FLAG.FRONT | FLAG.META;
      break;
    case Category.ParaIntroductions:
    case Category.ParaPeripheral:
      word |= FLAG.FRONT;
      break;
    case Category.ParaPoetry:
    case Category.ParaLists:
      word |= FLAG.POETRY;
      break;
    default:
      break;
  }
  if (kindBits !== null) {
    const kind = kindBits & ~TOKEN_SPELLING_BIT;
    const spelled = (kindBits & TOKEN_SPELLING_BIT) !== 0;
    if (
      kind === TokenKind.ClosingMarker ||
      kind === TokenKind.MilestoneTerminator ||
      (kind === TokenKind.Milestone && spelled)
    )
      word |= FLAG.CLOSER;
    if (
      unknown &&
      (kind === TokenKind.Marker ||
        kind === TokenKind.ClosingMarker ||
        kind === TokenKind.Milestone)
    )
      word |= FLAG.UNKNOWN;
  } else if (unknown) word |= FLAG.UNKNOWN;
  return word;
};

/** Which part of a note a span belongs to. */
export const NOTE_PART = {
  CALLER: 0,
  ORIGIN: 1,
  BODY: 2,
  MARKUP: 3,
} as const;

/** One span of a note, tagged with its `NOTE_PART`. */
export interface NotePart {
  readonly kind: number;
  readonly from: number;
  readonly to: number;
}

// ---------------------------------------------------------------------------
// Diagnostics
//
// A `DiagnosticView` is a cursor, not a value: these read one and hand back
// something a UI can hold. No text crosses the wasm wall to render a message —
// the caller supplies `slice` over the document it already has.
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning" | "info" | "hint";

export const diagnosticName = (finding: DiagnosticView): string => finding.code().name;

export const diagnosticFixLabel = (finding: DiagnosticView): string | null =>
  finding.code().fixLabel;

export const diagnosticMessage = (
  finding: DiagnosticView,
  slice: (from: number, to: number) => string,
): string => finding.message(slice);

/**
 * The severity this finding carries in a document declaring `usfmVersion`, or
 * `null` when the code says nothing there. `"form"` is folded into `null`: a
 * formatting observation is not a diagnostic the reader should be shown.
 */
export const diagnosticSeverity = (
  finding: DiagnosticView,
  usfmVersion: string | null,
): Severity | null => {
  const severity = finding.severity(usfmVersion);
  switch (severity) {
    case "error":
    case "warning":
    case "info":
    case "hint":
      return severity;
    default:
      return null;
  }
};
