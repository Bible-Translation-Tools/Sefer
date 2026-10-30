import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, type EditorState, type StateCommand } from "@codemirror/state";

import { expectedLastVerse } from "../expectedVerses";
import { isVisual, modeFacet, trusted } from "../kernel";
import { structureAt } from "../model/docStructure";
import { assignmentAt } from "../model/registry";
import { preferenceOn } from "../preferences";

/**
 * Verse numbers written the way people write them without USFM, as input
 * rules: typed ("4 ", "v4 ", "verse 4 "), taken back (Backspace just after
 * the number), and the one rule both share with a plain paste
 * (`isVerseNumber`, used by `plainPaste.ts`).
 */

/** "1", "1.", "v1", "v 1", "verse 1" at the end of what is before the caret, as its own word. */
const TYPED_VERSE = /(^|\s)((verse\s*|v\s*)?(\d{1,3})\.?)$/i;

/**
 * What verse numbers may come next at `pos`: the one past the verse before it
 * in its chapter (1 before any), the numbers the chapter already has, and the
 * chapter's expected last verse when the host said (`expectedVerses`).
 */
export function versesAround(
  state: EditorState,
  pos: number,
): { readonly next: number; readonly taken: ReadonlySet<number>; readonly last?: number } {
  const structure = structureAt(state);
  const chapter = structure.chapters.findLast((row) => row.from <= pos);
  const start = chapter?.from ?? 0;
  const end = chapter?.to ?? state.doc.length;
  const taken = new Set<number>();
  let previous = 0;
  for (const verse of structure.verses) {
    if (verse.markerFrom < start || verse.markerFrom > end) continue;
    const last = Number((verse.num ?? "").split("-").pop());
    if (!Number.isFinite(last)) continue;
    taken.add(last);
    if (verse.markerFrom < pos) previous = last;
  }
  return { next: previous + 1, taken, last: expectedLastVerse(state, pos) };
}

/**
 * Whether a typed number becomes a verse, given what is around it
 * (`versesAround`). Never a number the chapter already has: that stays as
 * typed. Otherwise the next verse in order always does, and so does any
 * number within the chapter's expected verses (the reference's count), out
 * of order or not. With no count, only the next one; "v7" or "verse 7" is
 * always a verse. Where it is typed does not matter.
 */
export function isVerseNumber(
  around: ReturnType<typeof versesAround>,
  number: number,
  prefixed: boolean,
): boolean {
  if (number < 1 || around.taken.has(number)) return false;
  if (prefixed || number === around.next) return true;
  return around.last !== undefined && number <= around.last;
}

/**
 * Verse numbers typed the way people write them without USFM — "1", "1.",
 * "v1", "v 1", "verse 1" — become a verse (`\\v N`) on the key after them
 * (`verseNumber.accept`, bound to Space by default),
 * when `isVerseNumber` says so: the next verse in order, or any number
 * within the chapter's expected verses, never one it already has. Undo, or
 * Backspace after the number, takes the verse back to what was typed. Refine
 * and line by line; USFM is typed as USFM.
 */
const acceptTypedVerseNumber: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  if (!sel.empty || state.facet(modeFacet) !== "regular") return false;
  if (!preferenceOn(state, "verseShortcuts")) return false;
  const from = sel.from;
  const line = state.doc.lineAt(from);
  const before = state.doc.sliceString(line.from, from);
  const typed = TYPED_VERSE.exec(before);
  if (typed === null) return false;
  const tokenFrom = line.from + typed.index + typed[1].length;
  const number = Number(typed[4]);
  if (!isVerseNumber(versesAround(state, from), number, typed[3] !== undefined)) return false;
  const insert = `\\v ${number} `;
  dispatch(
    state.update({
      changes: { from: tokenFrom, to: from, insert },
      selection: EditorSelection.cursor(tokenFrom + insert.length),
      annotations: [trusted.of("typed-verse"), isolateHistory.of("before")],
      userEvent: "input.type.verse",
    }),
  );
  return true;
};

/**
 * Backspace just after a verse's number, in Refine, takes the verse back to
 * the number it was typed as: `\\v 2 ` loses its `\\v ` and the 2 stays as a
 * word, as Word's Backspace undoes an autocorrect. A second Backspace then
 * deletes the digit like any other. Line by line keeps its numbers locked.
 */
const numberBackToAWord: StateCommand = ({ state, dispatch }) => {
  if (!isVisual(state) || assignmentAt(state).verseLines) return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const verse = structureAt(state).verses.find(
    (row) => row.num !== null && sel.from >= row.numTo && sel.from <= row.contentFrom,
  );
  if (verse === undefined || sel.from === verse.numFrom) return false;
  dispatch(
    state.update({
      changes: { from: verse.markerFrom, to: verse.numFrom },
      annotations: trusted.of("unverse"),
      userEvent: "delete.usfm.unverse",
      scrollIntoView: true,
    }),
  );
  return true;
};

/** The commands, by id; their keys are `keymaps.ts`'s. */
export const verseNumberCommands = {
  "verseNumber.accept": acceptTypedVerseNumber,
  "verseNumber.backToWord": numberBackToAWord,
};
