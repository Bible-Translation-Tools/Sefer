import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

import { trusted } from "../kernel";
import { docText, structureAt } from "../model/docStructure";
import { isEmptyVerse, verseEnd, verseIndexAt } from "../verseLines";

/**
 * A verse's three edits, as the verse menu offers them: change its number,
 * remove its marker (its text joins the verse before), add a verse after it.
 * Plain transaction specs, so any host can run them with no menu at all
 * (`BookEditorMount.renumberVerse` and its two neighbours); the menu
 * (`recipes/verseMenu.ts`) is one UI over them.
 *
 * Trusted, as every edit the editor builds itself is: the number and the
 * marker are hidden or locked markup a keystroke may not touch.
 */
const VERSE_EDIT = { annotations: trusted.of("verse"), scrollIntoView: true } as const;

/** What a verse number can be in USFM: 3, 3a, or a bridge such as 3-4 or 3a-4b. */
const VERSE_NUMBER = /^\d+[a-z]?(-\d+[a-z]?)?$/;

/** One more than a number's last digits: `3` → `4`, `3-4` → `5`; empty for none. */
export const nextNumber = (num: string | null): string => {
  const digits = /(\d+)\D*$/.exec(num ?? "");
  return digits ? String(Number(digits[1]) + 1) : "";
};

/** The verse whose marker, number or text holds `pos`, or -1 before the first. */
export const verseAt = (state: EditorState, pos: number): number =>
  verseIndexAt(structureAt(state), pos);

/**
 * Gives verse k the number `value`. `null` when it is no verse number (`3`,
 * `3a`, `3-4`) or the verse already has it.
 */
export function renumberVerse(
  state: EditorState,
  k: number,
  value: string,
): TransactionSpec | null {
  const verse = structureAt(state).verses[k];
  const number = value.trim();
  if (verse === undefined || number === verse.num || !VERSE_NUMBER.test(number)) return null;
  const spaced = /\s/.test(docText(state)[verse.numTo] ?? "");
  return {
    changes: { from: verse.numFrom, to: verse.numTo, insert: spaced ? number : `${number} ` },
    ...VERSE_EDIT,
  };
}

/** Removes verse k's marker; its text joins the verse before, an empty verse goes whole. */
export function removeVerseMarker(state: EditorState, k: number): TransactionSpec | null {
  const structure = structureAt(state);
  const verse = structure.verses[k];
  if (verse === undefined) return null;
  const doc = docText(state);
  if (doc[verse.markerFrom - 1] !== "\n")
    return { changes: { from: verse.markerFrom, to: verse.contentFrom }, ...VERSE_EDIT };
  const empty = isEmptyVerse(structure, doc, k);
  return {
    changes: { from: verse.markerFrom - 1, to: verse.contentFrom, insert: empty ? "" : " " },
    ...VERSE_EDIT,
  };
}

/** Adds an empty verse after verse k, numbered one past it, with the caret in it. */
export function addVerseAfter(state: EditorState, k: number): TransactionSpec | null {
  const structure = structureAt(state);
  const verse = structure.verses[k];
  if (verse === undefined) return null;
  const at = verseEnd(structure, docText(state), k);
  const insert = `\n\\v ${nextNumber(verse.num)} `;
  return {
    changes: { from: at, insert },
    selection: EditorSelection.cursor(at + insert.length),
    ...VERSE_EDIT,
  };
}
