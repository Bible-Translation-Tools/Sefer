import { StateEffect, StateField, type EditorState } from "@codemirror/state";

import { structureAt } from "./model/docStructure";

/**
 * How many verses each chapter is expected to have, by chapter number (`"23"`
 * → 6). The editor cannot know this from the text being written, so a host
 * hands it one, usually the last verse of each chapter of the reference text
 * beside it, as the engine's census counts it. Empty until it does, and then
 * nothing is capped.
 */
export type ExpectedVerses = ReadonlyMap<string, number>;

export const setExpectedVerses = StateEffect.define<ExpectedVerses>();

export const expectedVersesField = StateField.define<ExpectedVerses>({
  create: () => new Map(),
  update: (held, tr) => {
    for (const effect of tr.effects) if (effect.is(setExpectedVerses)) return effect.value;
    return held;
  },
});

/** The expected last verse of the chapter holding `pos`; undefined when no one said. */
export function expectedLastVerse(state: EditorState, pos: number): number | undefined {
  const held = state.field(expectedVersesField, false);
  if (held === undefined || held.size === 0) return undefined;
  const structure = structureAt(state);
  const chapter = structure.chapters.findLast((row) => row.from <= pos);
  const doc = state.doc.sliceString(chapter?.from ?? 0, (chapter?.from ?? 0) + 16);
  const number = /^\\c[ \t]+(\d+)/.exec(doc)?.[1];
  return number === undefined ? undefined : held.get(number);
}
