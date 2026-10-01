/**
 * Verse numbers that cannot be edited: Key terms' rule for its cards.
 *
 * A card on that screen IS a verse — the guide named it, the TOC found it —
 * and an edit that changed its `\v N` would take the card off the screen
 * ("No longer an occurrence") mid-sentence. So any change that deletes into a
 * verse's label, or types inside one, is refused; typing just before the
 * marker or just after the label stays free, because that is the verse text.
 *
 * The labels are the engine's, never read here: each TOC verse's `at` (the
 * marker) to `labelEnd` (after the number) and the one space after it, taken from the
 * parse the editor opened with and then MAPPED through every change. Not
 * re-read per keystroke: the parse runs a step behind the typing, and a rule
 * that waited for it would let exactly the fast Backspace through.
 */

import { EditorState, StateField, type Extension } from "@codemirror/state";

import { tocViewOf } from "#core/galley";
import { structureAt } from "#editor/index";

interface Label {
  readonly at: number;
  readonly end: number;
}

/** The labels of the parse `state` holds, when it describes this exact text. */
const labelsOf = (state: EditorState): readonly Label[] => {
  const analysis = structureAt(state).analysis;
  if (analysis == null || analysis.text.length !== state.doc.length) return [];
  // `labelEnd` is just past the number; the one whitespace character after it
  // separates the number from the text, and deleting it ("\v 21Keep") makes
  // a different verse number, so it is part of what is locked.
  return tocViewOf(analysis).verses.map((verse) => {
    const after = state.doc.sliceString(verse.labelEnd, verse.labelEnd + 1);
    return { at: verse.at, end: /\s/.test(after) ? verse.labelEnd + 1 : verse.labelEnd };
  });
};

const labels = StateField.define<readonly Label[]>({
  create: labelsOf,
  update: (held, transaction) => {
    // None yet (the parse had not landed when the editor opened): take them
    // as soon as it describes the text.
    if (held.length === 0) return labelsOf(transaction.state);
    if (!transaction.docChanged) return held;
    return held.map((label) => ({
      at: transaction.changes.mapPos(label.at, 1),
      end: transaction.changes.mapPos(label.end, -1),
    }));
  },
});

const refuseLabelEdits = EditorState.changeFilter.of((transaction) => {
  if (!transaction.docChanged) return true;
  const held = transaction.startState.field(labels, false) ?? [];
  let touches = false;
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (touches) return;
    for (const label of held) {
      const deletes = toA > fromA && fromA < label.end && toA > label.at;
      const insertsInside = fromA > label.at && fromA < label.end;
      if (deletes || insertsInside) {
        touches = true;
        return;
      }
    }
  });
  return !touches;
});

export const lockVerseLabels: Extension = [labels, refuseLabelEdits];
