/**
 * One projection-free classification table: token or node shape → `ClassKey`.
 *
 * First match wins, rows are bucketed by token kind, and NOTHING here knows
 * about presentation. That separation is the point: `registry.ts` decides how a
 * class paints and whether it may be edited, and it can be re-decided per mode
 * without touching a single classification. A shape this table cannot rule on
 * becomes a named `unmapped` row rather than a guess.
 */

import {
  Category,
  CloseReason,
  MarkerKind,
  NOTE_PART,
  SpecContext,
  StructuralWhitespaceRequirement,
  TokenKind,
} from "#core/galley";

import { type ClassKey, type OwnedSetName, OWNED_SETS } from "./registry";

export interface TokenShape {
  kind: number;
  markerKind: number | null;
  category: number | null;
  unknown: boolean;
  lineOpening: boolean;
  inNoteExtent: boolean;
  originScope: boolean;
  ctx: number;
  parentMarkerKind: number | null;
  designatorOf: "verse" | "chapter" | null;
  markerOf: "verse" | "chapter" | null;
  insideBlockExtent: boolean;
  closesNode: boolean;
  inWrapper: boolean;
}

export interface NodeShape {
  markerKind: number;
  category: number;
  ctx: number;
  close: number;
  ws: number;
  unknown: boolean;
  name: string | null;
  crossesLine: boolean;
}

export type UnmappedKind = "table" | "sidebar" | "needs-ruling" | "undecided";

export type Verdict = { class: ClassKey } | { unmapped: UnmappedKind; why: string };

export const isMapped = (v: Verdict): v is { class: ClassKey } => "class" in v;

export interface Row<S> {
  id: string;
  kinds?: readonly number[];
  when?: (s: S) => boolean;
  verdict: Verdict;
  set?: OwnedSetName;
  line?: true;
  block?: true;
  contains?: true;
  poetry?: true;
}

export type AnyRow = Row<TokenShape> | Row<NodeShape>;

const cls = (c: ClassKey): Verdict => ({ class: c });

const unmapped = (unmappedKind: UnmappedKind, why: string): Verdict => ({
  unmapped: unmappedKind,
  why,
});

export const isOriginReference = (name: string | null): boolean => name === "fr" || name === "xo";

export const trimsRecoveryNewline = (close: number): boolean => close !== CloseReason.Explicit;

const inNoteContext = (ctx: number): boolean =>
  ctx === SpecContext.Footnote || ctx === SpecContext.CrossReference;

const NOTE_TEXT_KINDS: readonly number[] = [
  TokenKind.Text,
  TokenKind.Newline,
  TokenKind.OptBreak,
  TokenKind.Pad,
];

const MARKER_KINDS: readonly number[] = [
  TokenKind.Marker,
  TokenKind.ClosingMarker,
  TokenKind.Milestone,
];

const TOKEN_ROWS: readonly Row<TokenShape>[] = [
  { id: "slot.v", when: (t) => t.designatorOf === "verse", verdict: cls("slot.v") },
  { id: "slot.c", when: (t) => t.designatorOf === "chapter", verdict: cls("slot.c") },
  {
    id: "designator.unruled",
    kinds: [TokenKind.Designator],
    verdict: unmapped(
      "needs-ruling",
      "\\ca \\cp \\va \\vp carry a Designator no toc row points at; and a Designator whose payload is not a number",
    ),
  },
  { id: "note.caller", kinds: [TokenKind.NoteCaller], verdict: cls("note.caller"), set: "note" },
  {
    id: "note.markup.note",
    kinds: MARKER_KINDS,
    when: (t) => t.markerKind === MarkerKind.Note,
    verdict: cls("note.markup"),
    set: "note",
  },
  {
    id: "note.markup.char",
    kinds: MARKER_KINDS,
    when: (t) => t.inNoteExtent && t.markerKind === MarkerKind.Character,
    verdict: cls("note.markup"),
  },
  {
    id: "note.body",
    kinds: NOTE_TEXT_KINDS,
    when: (t) => t.inNoteExtent,
    verdict: cls("note.body"),
  },
  { id: "note.markup", when: (t) => t.inNoteExtent, verdict: cls("note.markup") },
  { id: "pad", kinds: [TokenKind.Pad], verdict: cls("pad") },
  { id: "optbreak", kinds: [TokenKind.OptBreak], verdict: cls("optbreak") },
  {
    id: "newline.inside",
    kinds: [TokenKind.Newline],
    when: (t) => t.insideBlockExtent,
    verdict: cls("newline.inside"),
  },
  { id: "newline.between", kinds: [TokenKind.Newline], verdict: cls("newline.between") },
  {
    id: "milestone.token",
    kinds: [TokenKind.Milestone, TokenKind.MilestoneTerminator],
    verdict: cls("milestone"),
    set: "milestone",
  },
  {
    id: "milestone.marker",
    kinds: MARKER_KINDS,
    when: (t) => t.markerKind === MarkerKind.Milestone,
    verdict: cls("milestone"),
    set: "milestone",
  },
  {
    id: "attrs.char",
    kinds: [TokenKind.AttrList],
    when: (t) => t.parentMarkerKind === MarkerKind.Character,
    verdict: cls("char"),
  },
  {
    id: "attrs.unruled",
    kinds: [TokenKind.AttrList],
    verdict: unmapped("needs-ruling", "an AttrList on a Milestone or a \\periph has no class"),
  },
  {
    id: "closer.orphan",
    kinds: [TokenKind.ClosingMarker],
    when: (t) => !t.closesNode,
    verdict: unmapped(
      "needs-ruling",
      "a ClosingMarker that closes no node prints raw; a P5 leak with no row",
    ),
  },
  {
    id: "chunk",
    kinds: [TokenKind.Marker],
    when: (t) => t.unknown && t.lineOpening,
    verdict: cls("chunk"),
    set: "chunk",
    line: true,
  },
  {
    id: "unknown.midline",
    kinds: MARKER_KINDS,
    when: (t) => t.unknown,
    verdict: unmapped(
      "needs-ruling",
      "an unknown marker off a line start can swallow typed text; hiding it breaks P2, showing it breaks P5",
    ),
  },
  {
    id: "table",
    kinds: MARKER_KINDS,
    when: (t) => t.markerKind === MarkerKind.TableRow || t.markerKind === MarkerKind.TableCell,
    verdict: unmapped("table", "PROPERTIES §8.6 — no ownership bit"),
  },
  {
    id: "sidebar",
    kinds: MARKER_KINDS,
    when: (t) => t.markerKind === MarkerKind.Sidebar || t.markerKind === MarkerKind.Periph,
    verdict: unmapped("sidebar", "PROPERTIES §8.6"),
  },
  {
    id: "chrome.char",
    kinds: MARKER_KINDS,
    when: (t) => t.markerKind === MarkerKind.Character && t.inWrapper,
    verdict: cls("chrome"),
    set: "char",
  },
  {
    id: "char.unclosed",
    kinds: MARKER_KINDS,
    when: (t) => t.markerKind === MarkerKind.Character,
    verdict: unmapped(
      "needs-ruling",
      "a wrapper that never closed; DISSOLVE is defined over a wrapper with a closer",
    ),
  },
  {
    id: "chrome.designator.v",
    when: (t) => t.markerOf === "verse",
    verdict: cls("chrome"),
    set: "designator.v",
    line: true,
  },
  {
    id: "chrome.designator.c",
    when: (t) => t.markerOf === "chapter",
    verdict: cls("chrome"),
    set: "designator.c",
    line: true,
  },
  {
    id: "chrome.designator",
    kinds: MARKER_KINDS,
    when: (t) => t.markerKind === MarkerKind.Chapter || t.markerKind === MarkerKind.Verse,
    verdict: cls("chrome"),
  },
  {
    id: "chrome.block",
    kinds: MARKER_KINDS,
    when: (t) => t.markerKind === MarkerKind.Paragraph || t.markerKind === MarkerKind.Header,
    verdict: cls("chrome"),
  },
  {
    id: "figure",
    kinds: MARKER_KINDS,
    when: (t) => t.markerKind === MarkerKind.Figure,
    verdict: unmapped(
      "needs-ruling",
      "a \\fig is a Character-shaped node with no class; it renders raw today",
    ),
  },
  {
    id: "meta.marker",
    kinds: MARKER_KINDS,
    when: (t) => t.markerKind === MarkerKind.Meta,
    verdict: unmapped("needs-ruling", "\\cat and friends carry no class today"),
  },
  { id: "content.bookcode", kinds: [TokenKind.BookCode], verdict: cls("content") },
  { id: "content", kinds: [TokenKind.Text], verdict: cls("content") },
];

const TOKEN_FALLBACK: Row<TokenShape> = {
  id: "token.unmatched",
  verdict: unmapped("undecided", "no row matched — add one, do not branch at the call site"),
};

const NODE_ROWS: readonly Row<NodeShape>[] = [
  {
    id: "note",
    when: (n) => n.markerKind === MarkerKind.Note,
    verdict: cls("note.caller"),
    set: "note",
  },
  {
    id: "char.in.note",
    when: (n) => n.markerKind === MarkerKind.Character && inNoteContext(n.ctx),
    verdict: cls("note.markup"),
    set: "note",
  },
  {
    id: "char.unclosed",
    when: (n) => n.markerKind === MarkerKind.Character && n.close !== CloseReason.Explicit,
    verdict: unmapped(
      "needs-ruling",
      "CloseReason.Eof and CloseReason.Recovery wrappers overlap or swallow a newline; no WordRange today",
    ),
  },
  {
    id: "char.multiline",
    when: (n) => n.markerKind === MarkerKind.Character && n.crossesLine,
    verdict: unmapped(
      "needs-ruling",
      "a wrapper whose owned set spans a synthetic line break; the line-indexed fold hangs one WordRange off one line",
    ),
  },
  {
    id: "char.wrapper",
    when: (n) => n.markerKind === MarkerKind.Character,
    verdict: cls("char"),
    set: "char",
  },
  {
    id: "milestone",
    when: (n) => n.markerKind === MarkerKind.Milestone,
    verdict: cls("milestone"),
    set: "milestone",
  },
  {
    id: "designator.v",
    when: (n) => n.markerKind === MarkerKind.Verse,
    verdict: cls("slot.v"),
    set: "designator.v",
    line: true,
  },
  {
    id: "designator.c",
    when: (n) => n.markerKind === MarkerKind.Chapter,
    verdict: cls("slot.c"),
    set: "designator.c",
    line: true,
  },
  {
    id: "unknown",
    when: (n) => n.unknown || n.markerKind === MarkerKind.Unknown,
    verdict: unmapped(
      "needs-ruling",
      "FR-2 — an unknown marker opens no node and has no publishable name",
    ),
  },
  {
    id: "table.row",
    when: (n) => n.markerKind === MarkerKind.TableRow,
    verdict: unmapped(
      "table",
      "PROPERTIES §8.6 — no ownership bit; the row is a block extent and paints as one",
    ),
    line: true,
    block: true,
  },
  {
    id: "table.cell",
    when: (n) => n.markerKind === MarkerKind.TableCell,
    verdict: unmapped(
      "table",
      "PROPERTIES §8.6 — no ownership bit; a cell nests inside its row and opens no block",
    ),
    line: true,
  },
  {
    id: "sidebar",
    when: (n) => n.markerKind === MarkerKind.Sidebar,
    verdict: unmapped(
      "sidebar",
      "PROPERTIES §8.6 — a container whose extent holds other block extents",
    ),
    line: true,
    block: true,
    contains: true,
  },
  {
    id: "periph",
    when: (n) => n.markerKind === MarkerKind.Periph,
    verdict: unmapped(
      "sidebar",
      "PROPERTIES §8.6 — Category.Peripheral, so no FRONT bucket and no line of its own",
    ),
    block: true,
    contains: true,
  },
  {
    id: "block.blank",
    when: (n) =>
      n.markerKind === MarkerKind.Paragraph &&
      n.ws === StructuralWhitespaceRequirement.SingleNewline,
    verdict: cls("blank"),
    set: "block.blank",
    line: true,
    block: true,
    poetry: true,
  },
  {
    id: "block.meta",
    when: (n) =>
      n.category === Category.ParaIdentification || n.category === Category.DocumentStructure,
    verdict: cls("block.meta"),
    set: "block.meta",
    line: true,
    block: true,
  },
  {
    id: "block.heading",
    when: (n) => n.category === Category.ParaTitlesSections,
    verdict: cls("block.heading"),
    set: "block.heading",
    line: true,
    block: true,
  },
  {
    id: "block.front",
    when: (n) =>
      n.category === Category.ParaIntroductions || n.category === Category.ParaPeripheral,
    verdict: cls("block.front"),
    set: "block.front",
    line: true,
    block: true,
  },
  {
    id: "block.poetry",
    when: (n) =>
      (n.markerKind === MarkerKind.Paragraph || n.markerKind === MarkerKind.Header) &&
      (n.category === Category.ParaPoetry || n.category === Category.ParaLists),
    verdict: cls("block.para"),
    set: "block.para",
    line: true,
    block: true,
    poetry: true,
  },
  {
    id: "block.para",
    when: (n) => n.markerKind === MarkerKind.Paragraph || n.markerKind === MarkerKind.Header,
    verdict: cls("block.para"),
    set: "block.para",
    line: true,
    block: true,
  },
  {
    id: "figure",
    when: (n) => n.markerKind === MarkerKind.Figure,
    verdict: unmapped("needs-ruling", "a \\fig node has no class; it renders raw today"),
  },
  {
    id: "meta",
    when: (n) => n.markerKind === MarkerKind.Meta,
    verdict: unmapped("needs-ruling", "\\cat and friends carry no class today"),
  },
];

const NODE_FALLBACK: Row<NodeShape> = {
  id: "node.unmatched",
  verdict: unmapped("undecided", "no row matched — add one, do not branch at the call site"),
};

const KIND_SLOTS = 256;

const TOKEN_ROWS_BY_KIND: readonly (readonly Row<TokenShape>[])[] = (() => {
  const out: Row<TokenShape>[][] = [];
  for (let kind = 0; kind < KIND_SLOTS; kind++)
    out.push(TOKEN_ROWS.filter((r) => !r.kinds || r.kinds.includes(kind)));
  return out;
})();

export function kindsReaching(ids: readonly string[]): Uint8Array {
  const mask = new Uint8Array(KIND_SLOTS);
  for (let kind = 0; kind < KIND_SLOTS; kind++)
    if (TOKEN_ROWS_BY_KIND[kind].some((r) => ids.includes(r.id))) mask[kind] = 1;
  return mask;
}

function rowForTokenLinear(t: TokenShape): Row<TokenShape> {
  for (const r of TOKEN_ROWS)
    if ((!r.kinds || r.kinds.includes(t.kind)) && (!r.when || r.when(t))) return r;
  return TOKEN_FALLBACK;
}

export function rowForToken(t: TokenShape): Row<TokenShape> {
  const bucket = TOKEN_ROWS_BY_KIND[t.kind];
  if (bucket === undefined) return rowForTokenLinear(t);
  for (let i = 0; i < bucket.length; i++) {
    const r = bucket[i];
    if (r.when === undefined || r.when(t)) return r;
  }
  return TOKEN_FALLBACK;
}

function rowForNodeLinear(n: NodeShape): Row<NodeShape> {
  for (const r of NODE_ROWS) if (!r.when || r.when(n)) return r;
  return NODE_FALLBACK;
}

const NODE_ROW_MEMO = new Map<number, Row<NodeShape>>();

function nodeShapeKey(n: NodeShape): number {
  if (n.markerKind >>> 4 || n.category >>> 5 || n.ctx >>> 5 || n.close >>> 2 || n.ws >>> 3)
    return -1;
  return (
    n.markerKind |
    (n.category << 4) |
    (n.ctx << 9) |
    (n.close << 14) |
    (n.unknown ? 1 << 16 : 0) |
    (n.crossesLine ? 1 << 17 : 0) |
    (n.ws << 18)
  );
}

export function rowForNode(n: NodeShape): Row<NodeShape> {
  const key = nodeShapeKey(n);
  if (key < 0) return rowForNodeLinear(n);
  const held = NODE_ROW_MEMO.get(key);
  if (held !== undefined) return held;
  const row = rowForNodeLinear(n);
  NODE_ROW_MEMO.set(key, row);
  return row;
}

const classify = (t: TokenShape): Verdict => rowForToken(t).verdict;

export function notePartOf(t: TokenShape): number {
  const v = classify(t);
  if (!isMapped(v)) return NOTE_PART.MARKUP;
  if (v.class === "note.caller") return NOTE_PART.CALLER;
  if (v.class === "note.body") return t.originScope ? NOTE_PART.ORIGIN : NOTE_PART.BODY;
  return NOTE_PART.MARKUP;
}

export const lineOwnerRow = (byToken: Row<TokenShape>, byNode: Row<NodeShape> | null): AnyRow =>
  byToken.line === true ? byToken : (byNode ?? byToken);

export const ownsItsLine = (row: AnyRow | null): boolean => row?.line === true;

const UNOWNED_LINE_CLASS: ClassKey = "block.para";

export function paintedClassOf(row: AnyRow | null): ClassKey {
  const painting = row?.set ? OWNED_SETS[row.set]?.painting : undefined;
  return painting && painting.length ? painting[0] : UNOWNED_LINE_CLASS;
}

export const lineClassOf = (row: AnyRow | null): ClassKey =>
  ownsItsLine(row) ? paintedClassOf(row) : UNOWNED_LINE_CLASS;

export const opensBlock = (row: AnyRow): boolean => row.block === true;

export const containsBlocks = (row: AnyRow): boolean => row.contains === true;

export const isPoetryBlock = (row: AnyRow): boolean => row.poetry === true;

export const chromeEndsAtMarkerToken = (cls: ClassKey): boolean =>
  cls === "slot.v" || cls === "slot.c";

export const MARKUP_TOKEN_KINDS: ReadonlySet<number> = new Set<number>([
  TokenKind.Marker,
  TokenKind.ClosingMarker,
  TokenKind.Milestone,
  TokenKind.MilestoneTerminator,
]);
