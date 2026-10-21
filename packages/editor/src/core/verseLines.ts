import type { EditorState } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";

import { docText, structureAt, type DocStructure } from "./docStructure";
import { assignmentAt } from "./registry";

/** The verse the caret is in: the last one whose marker starts at or before it, or -1 before the first. */
const verseIndexAt = (structure: DocStructure, pos: number): number => {
  let found = -1;
  for (let k = 0; k < structure.verses.length; k++) {
    if (structure.verses[k].markerFrom > pos) break;
    found = k;
  }
  return found;
};

/** Where verse k's text ends: before the next verse, past no trailing space, newline or marker-only line. */
const verseEnd = (structure: DocStructure, doc: string, k: number): number => {
  const verse = structure.verses[k];
  const next = structure.verses[k + 1]?.markerFrom ?? doc.length;
  let end = verse.contentFrom;
  for (const line of structure.lines) {
    if (line.from >= next) break;
    if (line.to <= verse.contentFrom || line.contentFrom >= line.to) continue;
    end = Math.min(line.to, next);
  }
  while (end > verse.contentFrom && /\s/.test(doc[end - 1])) end--;
  return end;
};

const isEmptyVerse = (structure: DocStructure, doc: string, k: number): boolean =>
  verseEnd(structure, doc, k) <= structure.verses[k].contentFrom;

const goTo = (view: EditorView, pos: number): boolean => {
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, userEvent: "select" });
  return true;
};

type VerseMove = (structure: DocStructure, doc: string, here: number) => number | undefined;

/** A key that acts only under the line-by-line projection; elsewhere it falls through to the normal keys. */
const inVerseLines =
  (move: VerseMove) =>
  (view: EditorView): boolean => {
    const state: EditorState = view.state;
    if (!assignmentAt(state).verseLines) return false;
    const structure = structureAt(state);
    const doc = docText(state);
    const to = move(structure, doc, verseIndexAt(structure, state.selection.main.head));
    return to === undefined ? true : goTo(view, to);
  };

const nextVerse: VerseMove = (structure, _doc, here) => structure.verses[here + 1]?.contentFrom;

const previousVerse: VerseMove = (structure, _doc, here) =>
  here > 0 ? structure.verses[here - 1].contentFrom : undefined;

const nextEmptyVerse: VerseMove = (structure, doc, here) => {
  for (let k = here + 1; k < structure.verses.length; k++)
    if (isEmptyVerse(structure, doc, k)) return structure.verses[k].contentFrom;
  return undefined;
};

const previousEmptyVerse: VerseMove = (structure, doc, here) => {
  for (let k = here - 1; k >= 0; k--)
    if (isEmptyVerse(structure, doc, k)) return structure.verses[k].contentFrom;
  return undefined;
};

const verseStart: VerseMove = (structure, _doc, here) =>
  here >= 0 ? structure.verses[here].contentFrom : undefined;

const verseFinish: VerseMove = (structure, doc, here) =>
  here >= 0 ? verseEnd(structure, doc, here) : undefined;

/**
 * Line-by-line's keys (the form-mode plan's table): Enter and Shift-Enter step
 * a verse, Tab and Shift-Tab step to an empty verse, Home and End stay inside
 * the verse. Nothing here edits; a key with nowhere to go is consumed.
 */
export function verseLineKeys(): readonly KeyBinding[] {
  return [
    { key: "Enter", run: inVerseLines(nextVerse) },
    { key: "Shift-Enter", run: inVerseLines(previousVerse) },
    { key: "Tab", run: inVerseLines(nextEmptyVerse) },
    { key: "Shift-Tab", run: inVerseLines(previousEmptyVerse) },
    { key: "Home", run: inVerseLines(verseStart) },
    { key: "End", run: inVerseLines(verseFinish) },
  ];
}
