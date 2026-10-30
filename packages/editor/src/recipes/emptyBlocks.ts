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
import type { ClassKey } from "../core/model/registry";
import { renderRangeAt, renderRangeField } from "../core/paint/render";
import { emptyChapters } from "../core/verseLines";

type BlockNamer = (marker: string) => string;

export const blockNamer = Facet.define<BlockNamer, BlockNamer>({
  combine: (values) => values[0] ?? ((marker) => `\\${marker}`),
});

const NAMEABLE = new Set<ClassKey>(["block.para", "block.heading", "block.front"]);

const initialAnnotate = Facet.define<boolean, boolean>({ combine: (v) => v[0] ?? false });

const setAnnotate = StateEffect.define<boolean>();

const annotateField = StateField.define<boolean>({
  create: (state) => state.facet(initialAnnotate),
  update(on, tr) {
    for (const effect of tr.effects) if (effect.is(setAnnotate)) return effect.value;
    return on;
  },
});

const annotatingEmptyBlocks = (state: EditorState): boolean =>
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
    span.setAttribute("role", "note");
    return span;
  }

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
  const structure = structureAt(state);
  const windowRange = renderRangeAt(state) ?? { from: 0, to: state.doc.length };
  const name = state.facet(blockNamer);
  // An empty chapter's markers are hidden behind its empty state, which names
  // nothing: no ghost there either (`hideEmptyChapters`, core/paint/decorations.ts).
  const silent = emptyChapters(state.doc.toString(), structure);
  const hidden = (at: number): boolean => silent.some((c) => at > c.at && at <= c.to);
  const main = state.selection.main;
  const caret = main.empty ? main.head : null;
  const out = [];
  for (let i = 0; i < structure.blocks.length; i++) {
    if (structure.blocks.toAt(i) < windowRange.from) continue;
    if (structure.blocks.fromAt(i) > windowRange.to) break;
    if (!NAMEABLE.has(structure.blocks.clsAt(i))) continue;
    const b = structure.blocks.at(i);
    if (!blockIsEmpty(state, b.contentFrom, b.to) || hidden(b.contentFrom)) continue;
    // Not the one being written in: Enter makes an empty paragraph to type
    // into, and naming it then is noise. Left empty, it is named once the caret goes.
    if (caret !== null && caret >= b.from && caret <= b.to) continue;
    out.push(
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
  const structure = structureAt(state);
  const out: { from: number; marker: string }[] = [];
  for (let i = 0; i < structure.blocks.length; i++) {
    if (!NAMEABLE.has(structure.blocks.clsAt(i))) continue;
    const b = structure.blocks.at(i);
    if (blockIsEmpty(state, b.contentFrom, b.to)) out.push({ from: b.contentFrom, marker: b.kind });
  }
  return out;
}

/**
 * The annotation, as one extension. Mounted by `BookEditor`; a state that
 * never turns the annotation on pays one facet read per rebuild.
 */
export const annotateEmptyBlocks = (initial = false): Extension => [
  initialAnnotate.of(initial),
  annotateField,
  EditorView.decorations.compute(
    ["doc", "selection", structureField, renderRangeField, annotateField, blockNamer, modeFacet],
    ghosts,
  ),
];
