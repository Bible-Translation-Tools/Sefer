import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

import type { DocStructure } from "../core/docStructure";
import { structureAt } from "../core/editorState";
import { blockAt } from "../core/kernel";
import { blockIsEmpty } from "./emptyBlocks";
import { rangeDecorations } from "./rangeDecorations";

export interface PairedRange {
  readonly from: number;
  readonly to: number;
}

const initialPairing = Facet.define<boolean, boolean>({ combine: (v) => v[0] ?? false });

const setPairing = StateEffect.define<boolean>();

const pairingField = StateField.define<boolean>({
  create: (state) => state.facet(initialPairing),
  update(on, tr) {
    for (const effect of tr.effects) if (effect.is(setPairing)) return effect.value;
    return on;
  },
});

const pairingBlocks = (state: EditorState): boolean => state.field(pairingField, false) ?? false;

/**
 * Turn the marks on or off on a live view.
 *
 * Idempotent, and a no-op on a state that never installed the extension — the
 * shell says "on" once and every surface that listens obeys, which is what
 * keeps the editor and its panes from disagreeing about whether the feature
 * is running.
 */
export const showBlockPairs = (view: EditorView, on: boolean): void => {
  view.dispatch({ effects: setPairing.of(on) });
};

const SPAN = Decoration.mark({ class: "usfm-paired" });
const LINE = Decoration.line({ class: "usfm-paired-line" });

const decorationsFor = (
  doc: Parameters<typeof rangeDecorations>[0],
  range: PairedRange,
): DecorationSet => rangeDecorations(doc, range, SPAN, LINE);

const verseRange = (structure: DocStructure, pos: number): PairedRange | undefined => {
  const rows = structure.verses;
  let at = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined || row.markerFrom > pos) break;
    at = i;
  }
  const row = at < 0 ? undefined : rows[at];
  if (row === undefined) return undefined;
  const next = rows[at + 1];
  return { from: row.contentFrom, to: next?.markerFrom ?? Number.MAX_SAFE_INTEGER };
};

const hereIn = (state: EditorState): DecorationSet => {
  if (!pairingBlocks(state)) return Decoration.none;
  const head = state.selection.main.head;
  const structure = structureAt(state);
  const block = blockAt(structure, head);
  if (block !== null && blockIsEmpty(state, block.contentFrom, block.to))
    return decorationsFor(state.doc, { from: block.contentFrom, to: block.contentFrom });
  const verse = verseRange(structure, head);
  if (verse !== undefined) return decorationsFor(state.doc, verse);
  return block === null ? Decoration.none : decorationsFor(state.doc, block);
};

const hereField = StateField.define<DecorationSet>({
  create: hereIn,
  update(held, tr) {
    const toggled = tr.effects.some((effect) => effect.is(setPairing));
    if (!tr.docChanged && tr.selection === undefined && !toggled) return held;
    return hereIn(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The editor's half: mark the block the caret is in. `on` is the initial state. */
export const pairingHere = (on = false): Extension => [
  initialPairing.of(on),
  pairingField,
  hereField,
];

const setPaired = StateEffect.define<PairedRange | null>();

const toldField = StateField.define<PairedRange | null>({
  create: () => null,
  update(held, tr) {
    for (const effect of tr.effects) if (effect.is(setPaired)) return effect.value;
    if (tr.docChanged && held !== null)
      return { from: tr.changes.mapPos(held.from), to: tr.changes.mapPos(held.to) };
    return held;
  },
});

const toldDecorations = EditorView.decorations.compute([toldField, pairingField], (state) => {
  const range = state.field(toldField);
  return range === null || !pairingBlocks(state)
    ? Decoration.none
    : decorationsFor(state.doc, range);
});

/** The reference's half: mark the range it is told. `on` is the initial state. */
export const pairingThere = (on = false): Extension => [
  initialPairing.of(on),
  pairingField,
  toldField,
  toldDecorations,
];

/**
 * Show `range` as the paired block, or clear it with `null`.
 *
 * Dropped by a state with the toggle off, so a caller may dispatch without
 * first asking whether anyone is listening.
 */
export const showPaired = (view: EditorView, range: PairedRange | null): void => {
  view.dispatch({ effects: setPaired.of(range) });
};
