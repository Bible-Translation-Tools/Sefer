/**
 * Policy as data: for each `ClassKey`, how it paints and how mutable it is —
 * Table 3 of the design, as a record (seams §3.4).
 *
 * `PROJECTIONS` are deltas over the default registry, so a mode ("usfm",
 * "hide-notes", "lock-structure") is a small patch and not a code path. No rule
 * anywhere branches on a projection name; they read `cellAt(state, cls)`. The
 * struck combinations are listed rather than merely unused, so an assignment
 * that reaches an unlawful cell is a caught error and not a strange screen.
 */

import { Facet, type EditorState } from "@codemirror/state";

export type Paint = "point" | "boundary" | "ambient" | "none";

export type Mutability = "direct" | "via-anchor" | "trusted-only" | "immortal";

export interface Cell {
  paint: Paint;
  mutability: Mutability;
}

export type OwnershipBit = "JOIN" | "REFUSE" | "DISSOLVE";

export type ClassKey =
  | "content"
  | "pad"
  | "newline.between"
  | "newline.inside"
  | "slot.v"
  | "slot.c"
  | "chrome"
  | "block.para"
  | "block.heading"
  | "block.front"
  | "block.meta"
  | "char"
  | "optbreak"
  | "blank"
  | "milestone"
  | "note.caller"
  | "note.markup"
  | "note.body"
  | "chunk"
  | "clamp.replaced"
  | "table"
  | "sidebar";

export const CLASS_KEYS: readonly ClassKey[] = [
  "content",
  "pad",
  "newline.between",
  "newline.inside",
  "slot.v",
  "slot.c",
  "chrome",
  "block.para",
  "block.heading",
  "block.front",
  "block.meta",
  "char",
  "optbreak",
  "blank",
  "milestone",
  "note.caller",
  "note.markup",
  "note.body",
  "chunk",
  "clamp.replaced",
  "table",
  "sidebar",
];

const cellKey = (c: Cell) => `${c.paint}×${c.mutability}`;

const STRUCK: Record<string, string> = {
  "none×direct":
    "H3 (orphan chrome) / P1–P2 (invisible edits) — the content_from-swallowed-space bug, as a law",
  "boundary×direct": "C2 — a boundary is never self-owned; its referent is the following anchor",
  "ambient×direct": "C1 — no position, so no gesture can address it directly",
  "boundary×trusted-only": "unused",
  "ambient×trusted-only": "unused",
};

const isLawful = (c: Cell) => !(cellKey(c) in STRUCK);

export type WidgetKey = "versePip" | "join" | "joinSigil";

export interface RegistryRow {
  cell: Cell;
  ownership?: OwnershipBit;
  widget?: WidgetKey;
  residual?: true;
  typable?: true;
  note?: string;
  elided?: true;
  undecided?: true;
}

export type Registry = Record<ClassKey, RegistryRow>;

const DEFAULT_REGISTRY: Registry = {
  content: { cell: { paint: "point", mutability: "direct" } },
  pad: {
    cell: { paint: "point", mutability: "direct" },
    note: "visible surplus whitespace, caret stops (H2)",
  },
  "newline.between": {
    cell: { paint: "boundary", mutability: "via-anchor" },
    note: "referent = the following block anchor",
  },
  "newline.inside": {
    cell: { paint: "point", mutability: "direct" },
    widget: "join",
    note: "a joined newline IS a space (2026-09-03) — the positional rule, drawn by the widget column",
  },
  "slot.v": {
    cell: { paint: "point", mutability: "via-anchor" },
    typable: true,
    note: "Table 3's policy carve-out: via-anchor for DELETION (H4 takes own(\\v) whole), direct for TYPING — the digits are editable text with hard edges. Box when EMPTY.",
    widget: "versePip",
    residual: true,
  },
  "slot.c": {
    cell: { paint: "point", mutability: "immortal" },
    ownership: "REFUSE",
    note: "E5 — renumbering a chapter is USFM mode's job",
  },
  chrome: {
    cell: { paint: "none", mutability: "via-anchor" },
    note: "marker + at most one folded delimiter; trusted interior writes allowed",
  },
  "block.para": {
    cell: { paint: "ambient", mutability: "via-anchor" },
    ownership: "JOIN",
    note: "PARA ± POETRY — \\p \\q* \\m \\li*",
  },
  "block.heading": {
    cell: { paint: "ambient", mutability: "via-anchor" },
    ownership: "JOIN",
    note: "PARA + HEADING — \\s* \\d \\mt \\ms \\r; weight is its ambient paint, the bit is a paragraph's (2026-09-03)",
  },
  "block.front": {
    cell: { paint: "ambient", mutability: "via-anchor" },
    ownership: "JOIN",
    note: "PARA + introductions/peripheral — \\ip \\is \\imt \\io; its own ambient indent, a paragraph's bit",
  },
  "block.meta": {
    cell: { paint: "ambient", mutability: "via-anchor" },
    ownership: "REFUSE",
    note: "FRONT+META machine lines — \\id \\usfm \\h \\toc#",
  },
  char: {
    cell: { paint: "ambient", mutability: "via-anchor" },
    ownership: "DISSOLVE",
    note: "derived, no bit on the wire: opener + closer die with the last glyph",
  },
  optbreak: {
    cell: { paint: "point", mutability: "direct" },
    note: "// — referent is its own two bytes; the one point×direct class that is not a glyph",
  },
  blank: {
    cell: { paint: "boundary", mutability: "via-anchor" },
    ownership: "JOIN",
    note: "\\b — its blank line IS its paint; no interior stop, C2-empty consumes it whole",
  },
  milestone: { cell: { paint: "point", mutability: "via-anchor" }, note: "pips" },
  "note.caller": {
    cell: { paint: "point", mutability: "via-anchor" },
    note: "the anchor of the whole note",
  },
  "note.markup": {
    cell: { paint: "none", mutability: "trusted-only" },
    elided: true,
    note: "frozen; the attrs popover and a satellite are the trusted surfaces",
  },
  "note.body": {
    cell: { paint: "none", mutability: "trusted-only" },
    elided: true,
    note: "none in the main editor; (point, trusted-constrained) in its satellite — the projection example",
  },
  chunk: {
    cell: { paint: "point", mutability: "via-anchor" },
    note: "the unknown-marker toggle; hides to (none, immortal) declared-elided",
  },
  "clamp.replaced": {
    cell: { paint: "none", mutability: "immortal" },
    elided: true,
    note: "region override, not a class",
  },
  table: { cell: { paint: "point", mutability: "direct" }, undecided: true, note: "out of scope" },
  sidebar: {
    cell: { paint: "point", mutability: "direct" },
    undecided: true,
    note: "out of scope",
  },
};

interface OwnedSet {
  painting: ClassKey[];
  hidden: ClassKey[];
}

export const OWNED_SETS = {
  "designator.v": { painting: ["slot.v"], hidden: ["chrome"] },
  "designator.c": { painting: ["slot.c"], hidden: ["chrome"] },
  "block.para": { painting: ["block.para", "newline.between"], hidden: ["chrome"] },
  "block.heading": { painting: ["block.heading", "newline.between"], hidden: ["chrome"] },
  "block.front": { painting: ["block.front", "newline.between"], hidden: ["chrome"] },
  "block.meta": { painting: ["block.meta"], hidden: ["chrome"] },
  "block.blank": { painting: ["blank"], hidden: ["chrome"] },
  char: { painting: ["char"], hidden: ["chrome"] },
  note: { painting: ["note.caller"], hidden: ["note.markup", "note.body"] },
  chunk: { painting: ["chunk"], hidden: ["chrome"] },
  milestone: { painting: ["milestone"], hidden: [] },
  optbreak: { painting: ["optbreak"], hidden: [] },
} satisfies Record<string, OwnedSet>;

export type OwnedSetName = keyof typeof OWNED_SETS;

// SAFETY: `OwnedSetName` is `keyof typeof OWNED_SETS`, so the object's own
// keys are exactly that type; `Object.keys` only widens it to string.
const OWNED_SET_NAMES = Object.keys(OWNED_SETS) as OwnedSetName[];

export function setsPaintedBy(cls: ClassKey): OwnedSetName[] {
  // SAFETY: every value of OWNED_SETS is an OwnedSet; the assertion only
  // recovers the shared shape the literal's inferred type split per key.
  return OWNED_SET_NAMES.filter((k) => (OWNED_SETS[k] as OwnedSet).painting.includes(cls));
}

export type AssignmentDelta = Partial<Record<ClassKey, Partial<Cell>>>;

export interface Assignment {
  rows: Registry;
  clamped: { cls: ClassKey; to: "pip" | "freeze"; set: OwnedSetName }[];
}

class UnclampableDelta extends Error {}

const clone = (r: Registry): Registry => {
  // SAFETY: the loop immediately below assigns every CLASS_KEYS entry, and
  // `Registry` is `Record<ClassKey, RegistryRow>` — so the record is total
  // before it is read.
  const out = {} as Registry;
  for (const k of CLASS_KEYS) out[k] = { ...r[k], cell: { ...r[k].cell } };
  return out;
};

function resolve(base: Registry, deltas: readonly AssignmentDelta[]): Assignment {
  const rows = clone(base);
  const clamped: Assignment["clamped"] = [];

  const hidden = new Set<ClassKey>();
  for (const d of deltas)
    // SAFETY: `AssignmentDelta` is `Partial<Record<ClassKey, …>>`, so its own
    // keys are ClassKeys; `d[k]` below is checked for undefined anyway.
    for (const k of Object.keys(d) as ClassKey[]) {
      const patch = d[k];
      if (!patch) continue;
      if (!rows[k]) throw new UnclampableDelta(`unknown class "${k}"`);
      if (patch.paint === "none" && rows[k].cell.paint !== "none") hidden.add(k);
      if (patch.paint !== undefined && patch.paint !== "none") hidden.delete(k);
      rows[k].cell = { ...rows[k].cell, ...patch };
      if (rows[k].cell.mutability === "immortal" || rows[k].cell.mutability === "trusted-only")
        delete rows[k].typable;
    }

  for (const cls of hidden) {
    const sets = setsPaintedBy(cls);
    for (const name of sets) {
      const set: OwnedSet = OWNED_SETS[name];
      const stillPaints = set.painting.some((m) => rows[m].cell.paint !== "none");
      if (stillPaints) continue;
      if (rows[cls].residual && rows[cls].widget) {
        const m = rows[cls].cell.mutability;
        rows[cls].cell = {
          paint: "point",
          mutability: m === "immortal" || m === "trusted-only" ? m : "via-anchor",
        };
        clamped.push({ cls, to: "pip", set: name });
        continue;
      }
      for (const m of [...set.painting, ...set.hidden]) {
        rows[m].cell = { paint: "none", mutability: "immortal" };
        rows[m].elided = true;
        delete rows[m].typable;
      }
      clamped.push({ cls, to: "freeze", set: name });
    }
  }

  for (const k of CLASS_KEYS) {
    const c = rows[k].cell;
    if (isLawful(c)) continue;
    throw new UnclampableDelta(
      `"${k}" would land at the struck cell ${cellKey(c)} — ${STRUCK[cellKey(c)]}`,
    );
  }
  return { rows, clamped };
}

export const PROJECTIONS: Record<string, AssignmentDelta> = {
  default: {},
  // SAFETY: built from CLASS_KEYS with a `Partial<Cell>` value per key, which
  // is what AssignmentDelta is; `Object.fromEntries` loses only the key type.
  usfm: Object.fromEntries(
    CLASS_KEYS.map((k) => [k, { paint: "point", mutability: "direct" }]),
  ) as AssignmentDelta,
  "lock-structure": {
    chrome: { mutability: "immortal" },
    "newline.between": { mutability: "immortal" },
    "block.para": { mutability: "immortal" },
    "block.heading": { mutability: "immortal" },
    "block.front": { mutability: "immortal" },
    "block.meta": { mutability: "immortal" },
    char: { mutability: "immortal" },
  },
  "lock-designators": {
    "slot.c": { mutability: "immortal" },
    "slot.v": { mutability: "immortal" },
  },
  "note-satellite": {
    "note.caller": { paint: "point", mutability: "direct" },
    "note.body": { paint: "point", mutability: "direct" },
  },
  "hide-notes": { "note.caller": { paint: "none" } },
  "hide-verse-numbers": { "slot.v": { paint: "none" } },
  "hide-chunks": { chunk: { paint: "none" } },
};

export const assignment = Facet.define<AssignmentDelta, Assignment>({
  combine: (deltas) => resolve(DEFAULT_REGISTRY, deltas),
});

const cellCache = new WeakMap<EditorState, Assignment>();

export function assignmentAt(state: EditorState): Assignment {
  let a = cellCache.get(state);
  if (!a) {
    a = state.facet(assignment);
    cellCache.set(state, a);
  }
  return a;
}

export const rowAt = (state: EditorState, cls: ClassKey): RegistryRow =>
  assignmentAt(state).rows[cls];

export const keyboardMutable = (row: RegistryRow) =>
  row.cell.mutability === "direct" || row.typable === true;

export const pipActive = (state: EditorState, cls: ClassKey) =>
  assignmentAt(state).clamped.some((c) => c.cls === cls && c.to === "pip");

export const ownershipOf = (row: RegistryRow): OwnershipBit | undefined =>
  row.ownership === "DISSOLVE" && row.cell.mutability === "immortal" ? undefined : row.ownership;

export const paintsItsOwnLineAmbient = (cls: ClassKey): boolean =>
  cls === "block.heading" || cls === "block.front" || cls === "block.meta";
