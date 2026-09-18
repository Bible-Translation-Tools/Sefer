/**
 * Blocks with no words, named where the words would go.
 *
 * A paragraph marker with nothing after it renders, in the reading view, as
 * nothing — a blank line the reader cannot tell from a line break. Most of the
 * time that is fine, because a translator who just pressed Enter knows what
 * they made. It stops being fine after MATCH FORMATTING: the overlay inserts a
 * source block the target lacks and, when the block belongs inside a verse,
 * inserts it EMPTY on purpose — "where a verse's text splits is unknowable
 * across languages", so the engine places the marker and a human places the
 * words (`core/galley/overlay.ts`). Twelve of those look exactly like twelve
 * blank lines, and the operation reads as having done nothing.
 *
 * So the ghost. Three things make it honest:
 *
 *  - **It is a widget, so it CANNOT reach the file.** `book.apply` takes offset
 *    changes; a decoration has no offsets in the document. This is not a rule
 *    somebody has to remember on the way to the serializer — there is no way
 *    to express it. The same mechanism already draws the empty verse
 *    designator's box (`core/decorations.ts`), which is the proof it works.
 *  - **It is drawn where the caret goes**, at `block.contentFrom` with a
 *    zero-length range, so the ghost sits exactly where typing starts. Type one
 *    character and the block is no longer empty, the set recomputes, and the
 *    ghost is gone.
 *  - **It is not a mode.** An empty block is a fact about the document however
 *    it got there. A mode would have to remember WHICH blocks an overlay made,
 *    and a remembered range over a document that keeps changing is the stale-
 *    range bug this codebase is arranged to make impossible. This is recomputed
 *    from the parse, so it cannot be stale.
 *
 * ## Empty LINE is not empty BLOCK
 *
 * The distinction the whole file turns on. Real USFM writes
 *
 *     \q
 *     \v 1 Blessed is the man
 *
 * — an empty `\q` LINE opening a block whose words are on the next line. That
 * block is not empty and must not be ghosted. The test is over the block's
 * lines together, which is what `blockTable` already groups.
 *
 * ## What counts as empty is deliberately the simplest thing
 *
 * Does this block hold any content — that is the whole test. An earlier
 * version also asked whether the block sat INSIDE a verse, so that `\m` alone
 * after a `\c` (twice in `fixtures/small-nt/19-PSA.usfm`) would be spared as
 * "punctuation". Will's call, 2026-09-18: an `\m` after a `\c` with no verse
 * content following it IS empty, and a rule that made exceptions for where the
 * emptiness sat was answering a harder question than anyone asked. Whether the
 * engine should model this on the CST is a kitchen question, not a reason for
 * the editor to grow a second definition.
 */

import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { structureAt, structureField } from "../core/editorState";
import { isVisual, modeFacet } from "../core/kernel";
import type { ClassKey } from "../core/registry";
import { renderRangeAt, renderRangeField } from "../core/render";

/**
 * How a marker is SAID, for a reader.
 *
 * A facet and not an import, for the reason `analyzer` is a facet: `src/editor`
 * may not reach into the app, and the names are interface copy that will be
 * translated. The shell supplies the localized function; a state that supplies
 * nothing shows the marker itself, which is wrong for a translator and exactly
 * right for a test.
 */
export type BlockNamer = (marker: string) => string;

export const blockNamer = Facet.define<BlockNamer, BlockNamer>({
  combine: (values) => values[0] ?? ((marker) => `\\${marker}`),
});

/** Ghosts are drawn for the discourse, not for the header or a deliberate gap. */
const NAMEABLE = new Set<ClassKey>(["block.para", "block.heading", "block.front"]);

/**
 * Whether this state draws the ghosts — a facet for the value a state OPENS
 * with, and a field so a live view can be told otherwise.
 *
 * The same shape `recipes/satellite.ts` gives its window, and for the same
 * reason: the setting is a reader's preference that can change under a mounted
 * view, and reconfiguring a compartment to flip one boolean is more moving
 * parts than one effect. `annotateEmptyBlocks(true)` is what a headless test
 * or a surface with an opinion passes.
 */
const initialAnnotate = Facet.define<boolean, boolean>({ combine: (v) => v[0] ?? false });

const setAnnotate = StateEffect.define<boolean>();

const annotateField = StateField.define<boolean>({
  create: (state) => state.facet(initialAnnotate),
  update(on, tr) {
    for (const effect of tr.effects) if (effect.is(setAnnotate)) return effect.value;
    return on;
  },
});

/** Is this state drawing them? */
export const annotatingEmptyBlocks = (state: EditorState): boolean =>
  state.field(annotateField, false) ?? false;

/**
 * Turn the ghosts on or off on a live view.
 *
 * Idempotent, and a no-op on a state that never installed the extension — a
 * satellite or a reference pane drops the effect rather than throwing, which
 * is what lets the shell say "on" once and not care who is listening.
 */
export const showEmptyBlocks = (view: EditorView, on: boolean): void => {
  view.dispatch({ effects: setAnnotate.of(on) });
};

class GhostWidget extends WidgetType {
  readonly label: string;

  constructor(label: string) {
    super();
    this.label = label;
  }

  eq(other: GhostWidget): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "usfm-ghost";
    span.textContent = this.label;
    // Not `aria-hidden`: a screen reader that skipped this would report the
    // same nothing the sighted reader was getting. It is a label for a real,
    // reachable caret position, so it is announced as one.
    span.setAttribute("role", "note");
    return span;
  }

  /**
   * The ghost is scenery. A click on it must land in the DOCUMENT — at the
   * offset the ghost is drawn over, which is where the reader is aiming — so
   * the view is told not to treat the event as the widget's.
   */
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Has this block no words at all?
 *
 * The whole span from where content starts to where the block ends, and NO
 * marker-stripping: a block's continuation lines carry text, not block
 * markers, so anything left here is content. That is what makes the empty-line
 * case come out right — `\q` whose verse is on the next line spans both lines,
 * so this reads "\n\v 1 Blessed is the man" and says no.
 *
 * Whitespace is not words: `\q2 ` with a trailing space the formatter left is
 * as empty as `\q2`, and a translator cannot see the difference either.
 */
export function blockIsEmpty(state: EditorState, from: number, to: number): boolean {
  return state.doc.sliceString(from, to).trim() === "";
}

function ghosts(state: EditorState): DecorationSet {
  if (!isVisual(state) || !annotatingEmptyBlocks(state)) return Decoration.none;
  const s = structureAt(state);
  const win = renderRangeAt(state) ?? { from: 0, to: state.doc.length };
  const name = state.facet(blockNamer);
  const out = [];
  for (let i = 0; i < s.blocks.length; i++) {
    if (s.blocks.toAt(i) < win.from) continue;
    if (s.blocks.fromAt(i) > win.to) break;
    if (!NAMEABLE.has(s.blocks.clsAt(i))) continue;
    const b = s.blocks.at(i);
    if (!blockIsEmpty(state, b.contentFrom, b.to)) continue;
    out.push(
      // `side: 1` so the caret lands BEFORE the ghost. With `-1` the reader
      // clicks the hole, the caret goes after the label, and the first
      // character typed appears on the wrong side of it.
      Decoration.widget({ widget: new GhostWidget(name(b.kind)), side: 1 }).range(b.contentFrom),
    );
  }
  return Decoration.set(out, true);
}

/**
 * Every empty block in this state, in document order — the same set the ghosts
 * are drawn from, for a caller that wants to COUNT them or go to one.
 */
export function emptyBlocks(state: EditorState): readonly { from: number; marker: string }[] {
  const s = structureAt(state);
  const out: { from: number; marker: string }[] = [];
  for (let i = 0; i < s.blocks.length; i++) {
    if (!NAMEABLE.has(s.blocks.clsAt(i))) continue;
    const b = s.blocks.at(i);
    if (blockIsEmpty(state, b.contentFrom, b.to)) out.push({ from: b.contentFrom, marker: b.kind });
  }
  return out;
}

/**
 * The annotation, as one extension. Mounted by `BookEditor`; a state that
 * never turns `annotateEmpty` on pays one facet read per rebuild.
 */
export const annotateEmptyBlocks = (initial = false): Extension => [
  initialAnnotate.of(initial),
  annotateField,
  EditorView.decorations.compute(
    ["doc", structureField, renderRangeField, annotateField, blockNamer, modeFacet],
    ghosts,
  ),
];
