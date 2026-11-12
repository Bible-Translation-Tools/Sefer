import {
  EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { MARKER_ATTRIBUTES } from "@wycliffeassociates/sefer-text/engine/analysis";

import { isVisual, trusted } from "../kernel";
import { type DocStructure, lineIndexAt, structureAt } from "../model/docStructure";
import type { WordRange } from "../model/fold";

/**
 * The character pair a typed marker wrote (`\nd \nd*`), while nothing has been
 * typed into it. `from` is the opener's start, `at` the place between the two
 * halves, `to` the closer's end.
 *
 * Only a pair Refine wrote for a typed marker is ever held; an empty pair that
 * came in a file is never held, so nothing here touches it. Typing into the pair
 * lets it go, and from then on it is ordinary text.
 */
export interface HeldRun {
  readonly from: number;
  readonly at: number;
  readonly to: number;
}

export const holdRun = StateEffect.define<HeldRun | null>();

const heldRunField = StateField.define<HeldRun | null>({
  create: () => null,
  update(held, tr) {
    for (const effect of tr.effects) if (effect.is(holdRun)) return effect.value;
    if (held === null || !tr.docChanged) return held;
    const from = tr.changes.mapPos(held.from, 1);
    const at = tr.changes.mapPos(held.at, -1);
    const to = tr.changes.mapPos(held.to, -1);
    // Anything typed into the pair, or an edit through it, and it is no longer an empty pair.
    if (to - from !== held.to - held.from || at - from !== held.at - held.from) return null;
    return { from, at, to };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (held) =>
      held === null
        ? Decoration.none
        : // At the pair's start, not between its halves: an empty pair is hidden
          // as one piece, and a widget inside it would be hidden with it.
          Decoration.set([Decoration.widget({ widget: EMPTY_RUN, side: -1 }).range(held.from)]),
    ),
});

/**
 * Just past a style run's closer, where → from the end of its words put the
 * caret. The caret leans into a run, so this is no stop of its own; it is one
 * while the caret is standing there, until the next edit or move, so that what
 * is typed next is outside the run.
 */
export const leaveRun = StateEffect.define<number>();

const leftRunField = StateField.define<number | null>({
  create: () => null,
  update(left, tr) {
    for (const effect of tr.effects) if (effect.is(leaveRun)) return effect.value;
    if (left === null || tr.docChanged) return null;
    const sel = tr.state.selection.main;
    return sel.empty && sel.head === left ? left : null;
  },
});

/**
 * The places the caret may stand that the stops would not otherwise allow:
 * between the halves of the held pair, and just past the run → left.
 */
export const extraStops = (state: EditorState): readonly number[] => {
  const out: number[] = [];
  const held = state.field(heldRunField, false)?.at;
  if (held !== undefined) out.push(held);
  const left = state.field(leftRunField, false);
  if (left !== null && left !== undefined) out.push(left);
  return out;
};

/** The empty pair, drawn: a tinted slot where the styled words will go. */
class EmptyRun extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "usfm-run-empty";
    return span;
  }
}
const EMPTY_RUN = new EmptyRun();

/**
 * A held pair the caret has left, still empty, is taken out in the same step:
 * a style that was asked for and never used leaves nothing in the file.
 */
const dropWhenLeft = EditorState.transactionFilter.of((tr) => {
  if (tr.startState.field(heldRunField, false) == null) return tr;
  if (tr.effects.some((effect) => effect.is(holdRun))) return tr;
  const held = tr.state.field(heldRunField, false) ?? null;
  if (held === null || !isVisual(tr.state)) return tr;
  const sel = tr.state.selection.main;
  if (sel.empty && sel.head === held.at) return tr;
  return [
    tr,
    {
      changes: { from: held.from, to: held.to },
      effects: holdRun.of(null),
      annotations: trusted.of("typed-usfm"),
      sequential: true,
    },
  ];
});

/**
 * Typing into the held pair. The editor's caret stands between two hidden
 * halves, but the browser has no place there to put its own, and puts it after
 * the closer; the letter is reported where the browser's caret is. While the
 * editor's caret is between the halves, input anywhere in the pair is the
 * caret's, so it goes in between them.
 */
const typeIntoHeld = EditorView.inputHandler.of((view, from, to, text) => {
  const held = view.state.field(heldRunField, false) ?? null;
  if (held === null || from < held.from || to > held.to) return false;
  const sel = view.state.selection.main;
  if (!sel.empty || sel.head !== held.at) return false;
  view.dispatch({
    changes: { from: held.at, insert: text },
    selection: { anchor: held.at + text.length },
    // The guards read a letter between two hidden halves as typing into markup.
    annotations: trusted.of("typed-usfm"),
    userEvent: "input.type",
    scrollIntoView: true,
  });
  return true;
});

/**
 * A run that is a style (`\nd`, `\wj`, `\bd`): not a figure, and not a run that
 * carries attributes (an aligned `\w`), which is a word rather than a style.
 */
const isStyleRun = (word: WordRange): boolean =>
  !word.figure && word.attrTo <= word.attrFrom && MARKER_ATTRIBUTES[word.marker] === undefined;

/**
 * Where → goes from the end of a style run's words: just past its closer, the
 * same place on screen but outside the run, so what is typed next is not
 * styled. Null when `pos` is not the end of one. The innermost run first, so a
 * nested run is left one press at a time.
 */
export function runExitAt(structure: DocStructure, pos: number): number | null {
  const row = lineIndexAt(structure, pos);
  if (row < 0) return null;
  let exit: number | null = null;
  for (const word of structure.lines.at(row).words)
    if (isStyleRun(word) && word.surfaceTo === pos && word.to > pos)
      exit = exit === null ? word.to : Math.min(exit, word.to);
  return exit;
}

/**
 * Backspace or Delete in the held pair takes the pair out, and nothing else:
 * the style asked for is not wanted after all. Left to the ordinary Backspace,
 * which steps over hidden markup, the key took the visible character before
 * the pair (a space, or a verse number's digit) and left the pair.
 */
export const dropHeldRun: Command = (view) => {
  const held = view.state.field(heldRunField, false) ?? null;
  const sel = view.state.selection.main;
  if (held === null || !sel.empty || sel.head !== held.at) return false;
  view.dispatch({
    changes: { from: held.from, to: held.to },
    selection: { anchor: held.from },
    effects: holdRun.of(null),
    annotations: trusted.of("typed-usfm"),
    userEvent: "delete.backward",
  });
  return true;
};

const RUN_TINT = Decoration.mark({ class: "usfm-run-caret" });

/**
 * The run the caret is typing in, tinted. At the end of a styled word the caret
 * has two places that look the same, just inside the closer and just after it;
 * the tint says which one it is in. Not for a run that carries attributes (an
 * aligned `\w`): those are words, not a style, and every word of an aligned text
 * would flash as the caret passed.
 */
const runTint = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_, tr) {
    const state = tr.state;
    const sel = state.selection.main;
    if (!isVisual(state) || !sel.empty) return Decoration.none;
    const structure = structureAt(state);
    const row = lineIndexAt(structure, sel.head);
    if (row < 0) return Decoration.none;
    const tints: Range<Decoration>[] = [];
    for (const word of structure.lines.at(row).words) {
      if (!isStyleRun(word)) continue;
      if (sel.head < word.surfaceFrom || sel.head > word.surfaceTo) continue;
      if (word.surfaceTo > word.surfaceFrom)
        tints.push(RUN_TINT.range(word.surfaceFrom, word.surfaceTo));
    }
    return Decoration.set(tints, true);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const heldRunBehaviour: Extension = [
  heldRunField,
  leftRunField,
  dropWhenLeft,
  runTint,
  typeIntoHeld,
];
