import type { Diagnostic } from "@codemirror/lint";
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  type Extension,
  Facet,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";

import { docText, structureAt, type DocStructure } from "./docStructure";
import type { VerseRow } from "./fold";
import { isVisual, trusted } from "./kernel";
import { assignmentAt } from "./registry";

/** The verse the caret is in: the last one whose marker starts at or before it, or -1 before the first. */
export const verseIndexAt = (structure: DocStructure, pos: number): number => {
  let found = -1;
  for (let k = 0; k < structure.verses.length; k++) {
    if (structure.verses[k].markerFrom > pos) break;
    found = k;
  }
  return found;
};

/** Lines that are not a verse's text: a heading, a chapter number, a book's front matter. */
const isLabel = (cls: string): boolean =>
  cls === "block.heading" || cls === "slot.c" || cls === "block.meta" || cls === "block.front";

/** Where verse k's text ends: before the next verse, past no trailing space, newline or marker-only line. */
export const verseEnd = (structure: DocStructure, doc: string, k: number): number => {
  const verse = structure.verses[k];
  const next = structure.verses[k + 1]?.markerFrom ?? doc.length;
  let end = verse.contentFrom;
  for (const line of structure.lines) {
    if (line.from >= next) break;
    if (line.to <= verse.contentFrom || line.contentFrom >= line.to || isLabel(line.cls)) continue;
    end = Math.min(line.to, next);
  }
  while (end > verse.contentFrom && /\s/.test(doc[end - 1])) end--;
  return end;
};

export const isEmptyVerse = (structure: DocStructure, doc: string, k: number): boolean =>
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

const isVerseLines = (state: EditorState): boolean => assignmentAt(state).verseLines;

/** Reading and line by line give a verse number a menu; USFM shows the marker itself. */
/**
 * Whether this surface has the verse menu (`recipes/verseMenu.ts`), an opt-in
 * feature: the lint popover leaves a number's findings to the menu only when
 * there is one, and `cm-number-menus` styles numbers as pressable.
 */
export const hasVerseMenu = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

export const numbersHaveMenus = (state: EditorState): boolean =>
  isVisual(state) && state.facet(hasVerseMenu);

/**
 * The number a finding's fix would give a verse, when the fix is exactly that: one edit
 * replacing the number's digits. The linter records it here; the menu pre-fills it.
 */
export const suggestedNumber = new WeakMap<Diagnostic, string>();

/** Headings and chapter numbers show as labels here: read-only, changed in Reading or USFM. */
const labelsStayPut = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged || !isVerseLines(tr.startState) || tr.annotation(trusted) !== undefined)
    return true;
  const ranges: number[] = [];
  for (const line of structureAt(tr.startState).lines)
    if (line.cls === "block.heading" || line.cls === "slot.c") ranges.push(line.from, line.to);
  return ranges.length === 0 ? true : ranges;
});

/** A paste is one line: its line breaks become spaces, so it can never start a verse. */
const pasteAsOneLine = EditorState.transactionFilter.of((tr): TransactionSpec | Transaction => {
  if (!tr.docChanged || !tr.isUserEvent("input.paste") || !isVerseLines(tr.startState)) return tr;
  let flattened = false;
  let lastTo = 0;
  const specs: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    const flat = text.replace(/[ \t]*\r?\n[ \t]*/g, " ");
    if (flat !== text) flattened = true;
    specs.push({ from: fromA, to: toA, insert: flat });
    lastTo = toA;
  });
  if (!flattened) return tr;
  const changes = ChangeSet.of(specs, tr.startState.doc.length);
  return {
    changes,
    selection: EditorSelection.cursor(changes.mapPos(lastTo, 1)),
    userEvent: "input.paste",
    scrollIntoView: true,
  };
});

/** A selection stays inside the verse it starts in. */
const selectionStaysInVerse = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || !isVerseLines(tr.state)) return tr;
  const range = tr.selection.main;
  if (range.empty) return tr;
  const structure = structureAt(tr.state);
  const k = verseIndexAt(structure, range.anchor);
  if (k < 0) return tr;
  const from = structure.verses[k].contentFrom;
  const to = Math.max(from, verseEnd(structure, docText(tr.state), k));
  const clamp = (pos: number): number => Math.min(Math.max(pos, from), to);
  const anchor = clamp(range.anchor);
  const head = clamp(range.head);
  if (anchor === range.anchor && head === range.head) return tr;
  return [tr, { selection: EditorSelection.single(anchor, head), sequential: true }];
});

/** Whether a finding's only fix deletes this verse's marker, which Remove verse marker already does. */
export const removesMarker = new WeakMap<Diagnostic, { from: number; to: number }>();
/** The span a verse number owns: its marker, its digits, and the box of an empty one. */
export const onNumber = (verse: VerseRow, from: number, to: number): boolean =>
  from === to
    ? from >= verse.markerFrom && from <= verse.contentFrom
    : from < verse.contentFrom && to > verse.markerFrom;

/**
 * Line-by-line shows a verse number's findings in its menu, so the hover
 * popover leaves them out: one popover per number, not two.
 */
export const leaveNumbersToTheMenu = (
  diagnostics: readonly Diagnostic[],
  state: EditorState,
): Diagnostic[] => {
  if (!numbersHaveMenus(state)) return [...diagnostics];
  const verses = structureAt(state).verses;
  return diagnostics.filter(
    (diagnostic) => !verses.some((verse) => onNumber(verse, diagnostic.from, diagnostic.to)),
  );
};

/**
 * Typing into an empty verse. Its number is locked here, so the number's own
 * typable edge is gone; this writes the text after it instead, with the space
 * that separates them when the file has none (`\v 4` becomes `\v 4 text`).
 */
const typeIntoEmptyVerse = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || !isVerseLines(view.state)) return false;
  const structure = structureAt(view.state);
  const doc = docText(view.state);
  const k = verseIndexAt(structure, from);
  if (k < 0 || !isEmptyVerse(structure, doc, k)) return false;
  const verse = structure.verses[k];
  if (from < verse.numTo) return false;
  const at = verse.contentFrom;
  const insert = /\s/.test(doc[at - 1] ?? "") ? text : ` ${text}`;
  view.dispatch({
    changes: { from: at, insert },
    selection: EditorSelection.cursor(at + insert.length),
    annotations: trusted.of("line-by-line"),
    userEvent: "input.type",
  });
  return true;
});

/** `cm-line-by-line` and `cm-number-menus` on the editor, for what the stylesheet does only there. */
const lineByLineClass = EditorView.editorAttributes.of((view) => {
  if (isVerseLines(view.state)) return { class: "cm-line-by-line cm-number-menus" };
  return numbersHaveMenus(view.state) ? { class: "cm-number-menus" } : null;
});

/** Everything line-by-line adds besides its keys and its layout. */
export const verseLineBehaviour: Extension = [
  lineByLineClass,
  typeIntoEmptyVerse,
  labelsStayPut,
  pasteAsOneLine,
  selectionStaysInVerse,
];
