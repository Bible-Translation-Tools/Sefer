/**
 * The block on THIS side that answers the block on the other one, drawn on
 * both sides at once.
 *
 * Match formatting moves a source's shape onto a target, and the empty-block
 * ghost beside this file says where the operation put a marker and left the
 * words to a human. This is the other half of the same question: not "is this
 * block empty" but **"what is that `\q2` in the source text"** — the reader is
 * standing in a block of their own book and wants to see which block of the
 * source it corresponds to.
 *
 * ## Both sides, or it says nothing
 *
 * A highlight on the reference alone is an assertion the reader cannot check:
 * they would still have to work out which of their own blocks it was answering.
 * So the editor marks the block the caret is in and every pane beside it marks
 * the block at the same address, and the correspondence is the pair of marks
 * rather than either one of them. Hence two extensions over one toggle:
 *
 *  - `pairingHere()` — derives the mark from THIS state: the caret, and the
 *    editor's own `DocStructure`. No engine call, nothing to tell it.
 *  - `pairingThere()` — is TOLD its range, because a reference cannot work out
 *    which of its blocks answers a caret in a document it has never seen. The
 *    shell computes the address (`ReferencePane`) and dispatches the result.
 *
 * Each side uses the cut it owns. The editor's blocks come from its own
 * structure — the same table the ghost and the breadcrumb read — and the
 * reference's come from the overlay skeleton, which is the only cut that has
 * an ADDRESS to match on. Making one side adopt the other's would mean an
 * engine call per keystroke to answer a question the editor can already
 * answer about itself.
 *
 * ## Why this is not `flash`
 *
 * `flash` is an EVENT: a jump landed here, look, and then it fades. This is a
 * STATE: while the caret is in that block, this is its pair, and it stops
 * being marked when the caret leaves rather than when a timer fires. A
 * highlight that faded under a stationary cursor would be answering a question
 * the reader is still asking.
 *
 * ## Mark, with a line fallback, for one specific reason
 *
 * A mark over the range, as `flash` argues: the reading projection joins and
 * hides whole lines, so a line decoration on a line the projection replaced
 * never appears.
 *
 * The fallback is not defensive. An overlay inserts an INSIDE block EMPTY on
 * purpose — where a verse's text splits is unknowable across languages — so
 * `from === to` is the ordinary case for exactly the blocks this feature
 * exists to explain, and a zero-width mark draws nothing. Those get the line,
 * which is also where the ghost's label sits, so the two agree about what they
 * are pointing at.
 */

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

export interface PairedRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Whether this state draws the pair — a facet for what it OPENS with, a field
 * so a live view can be told otherwise.
 *
 * The same shape `recipes/emptyBlocks.ts` gives its ghosts, and for the same
 * reason: it is a reader's preference that changes under a mounted view, and
 * reconfiguring a compartment to flip one boolean is more moving parts than
 * one effect.
 */
const initialPairing = Facet.define<boolean, boolean>({ combine: (v) => v[0] ?? false });

const setPairing = StateEffect.define<boolean>();

const pairingField = StateField.define<boolean>({
  create: (state) => state.facet(initialPairing),
  update(on, tr) {
    for (const effect of tr.effects) if (effect.is(setPairing)) return effect.value;
    return on;
  },
});

/** Is this state drawing them? */
export const pairingBlocks = (state: EditorState): boolean =>
  state.field(pairingField, false) ?? false;

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
  doc: { length: number; lineAt: (at: number) => { from: number } },
  range: PairedRange,
): DecorationSet => {
  const from = Math.max(0, Math.min(range.from, doc.length));
  const to = Math.max(from, Math.min(range.to, doc.length));
  return to > from
    ? Decoration.set([SPAN.range(from, to)], true)
    : Decoration.set([LINE.range(doc.lineAt(from).from)], true);
};

// ---------------------------------------------------------------------------
// Here: the block the caret is in, derived from this state alone.
// ---------------------------------------------------------------------------

/**
 * The verse `pos` is in, as a range — the editor's own table, and it carries
 * no end, so a verse reaches the next verse's marker.
 *
 * Coarser than the skeleton's `textFrom..textTo`, which stops before a heading
 * that follows the verse. The difference does not show: what is drawn is a
 * range on screen, and the reader is looking at where the words are, not at
 * where a parser thinks they stop.
 */
const verseRange = (s: DocStructure, pos: number): PairedRange | undefined => {
  const rows = s.verses;
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

/**
 * What to mark, in order of what the reader is actually asking.
 *
 *  1. An EMPTY block, if that is where the caret is. This is the overlay case
 *     and the reason the feature exists: the block has no words, so there is
 *     no verse text to point at, and the empty block IS the answer.
 *  2. The VERSE otherwise. A `\p` can run fifteen verses, and washing all of
 *     them is a page of highlight for a question about one line (Will,
 *     2026-09-18: "a full \p of like 15 verses is kinda a ton of busy
 *     highlighting"). A verse is the unit two texts agree about.
 *  3. The block, when there is no verse — front matter, a heading before
 *     `\v 1`. Something true beats nothing.
 */
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
    // Recomputed only when something that could move it moved. A scroll, a
    // measurement or a tooltip is a transaction too, and rebuilding a
    // decoration set for those would put this on the paint path for free.
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

// ---------------------------------------------------------------------------
// There: the block somebody else worked out, dispatched in.
// ---------------------------------------------------------------------------

const setPaired = StateEffect.define<PairedRange | null>();

const thereField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(held, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPairing) && !effect.value) return Decoration.none;
      if (!effect.is(setPaired)) continue;
      return effect.value === null || !pairingBlocks(tr.state)
        ? Decoration.none
        : decorationsFor(tr.state.doc, effect.value);
    }
    // Mapped through edits like any other decoration. A reference is read-only,
    // so this only fires when the projection reconfigures, and the alternative
    // — dropping it — would blink the mark on every mode flip.
    return tr.docChanged ? held.map(tr.changes) : held;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The reference's half: mark the range it is told. `on` is the initial state. */
export const pairingThere = (on = false): Extension => [
  initialPairing.of(on),
  pairingField,
  thereField,
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
