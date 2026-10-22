import { type Diagnostic, forEachDiagnostic } from "@codemirror/lint";
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, type KeyBinding, showTooltip, type Tooltip } from "@codemirror/view";

import { docText, structureAt, type DocStructure } from "./docStructure";
import type { VerseRow } from "./fold";
import { isVisual, trusted } from "./kernel";
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

/** Lines that are not a verse's text: a heading, a chapter number, a book's front matter. */
const isLabel = (cls: string): boolean =>
  cls === "block.heading" || cls === "slot.c" || cls === "block.meta" || cls === "block.front";

/** Where verse k's text ends: before the next verse, past no trailing space, newline or marker-only line. */
const verseEnd = (structure: DocStructure, doc: string, k: number): number => {
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

const isVerseLines = (state: EditorState): boolean => assignmentAt(state).verseLines;

/** Reading and line by line give a verse number a menu; USFM shows the marker itself. */
const numbersHaveMenus = (state: EditorState): boolean => isVisual(state);

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

/** The open menu: a verse number's, or the findings on one line (from the gutter). */
const openVerseMenu = StateEffect.define<number | null>();

const verseMenuField = StateField.define<number | null>({
  create: () => null,
  update(open, tr) {
    for (const effect of tr.effects) if (effect.is(openVerseMenu)) return effect.value;
    return tr.docChanged ? null : open;
  },
  provide: (field) =>
    showTooltip.compute([field], (state): Tooltip | null => {
      const k = state.field(field);
      const verse = k === null ? undefined : structureAt(state).verses[k];
      if (k === null || verse === undefined) return null;
      return { pos: verse.numFrom, above: false, create: (view) => verseMenu(view, k) };
    }),
});

/** What a verse number can be in USFM: 3, 3a, or a bridge such as 3-4 or 3a-4b. */
const VERSE_NUMBER = /^\d+[a-z]?(-\d+[a-z]?)?$/;

const nextNumber = (num: string | null): string => {
  const digits = /(\d+)\D*$/.exec(num ?? "");
  return digits ? String(Number(digits[1]) + 1) : "";
};

const button = (label: string, run: () => void): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", run);
  return element;
};

/** The verse number's menu: change it, remove its marker (its text joins the verse before), or add one after it. */
function verseMenu(view: EditorView, k: number): { dom: HTMLElement } {
  const close = (): void => closeMenu(view);
  const edit = (spec: TransactionSpec): void => {
    view.dispatch({ ...spec, annotations: trusted.of("line-by-line"), scrollIntoView: true });
    close();
    view.focus();
  };
  const verse = structureAt(view.state).verses[k];

  const dom = document.createElement("div");
  dom.className = "usfm-verse-menu";
  let suggestion: string | undefined;
  for (const { diagnostic, from, to } of findingsOnNumber(view.state, verse)) {
    const said = document.createElement("div");
    said.className = `usfm-verse-finding usfm-verse-finding-${diagnostic.severity}`;
    said.textContent = sentenceCase(diagnostic.message);
    dom.append(said);
    suggestion ??= suggestedNumber.get(diagnostic);
    if (suggestedNumber.has(diagnostic) || removesTheMarker(diagnostic, verse)) continue;
    for (const action of diagnostic.actions ?? [])
      dom.append(
        button(sentenceCase(action.name.replace(/^Fix:\s*/, "")), () => {
          action.apply(view, from, to);
          close();
          view.focus();
        }),
      );
  }

  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = "Change number";
  const input = document.createElement("input");
  const before = structureAt(view.state).verses[k - 1];
  const guess = verse.num === null && before !== undefined ? nextNumber(before.num) : undefined;
  input.value = suggestion ?? verse.num ?? guess ?? "";
  input.size = 4;
  input.setAttribute("aria-label", "Verse number");
  input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
  label.append(input);
  form.append(label);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (value === verse.num) return close();
    if (!VERSE_NUMBER.test(value)) {
      input.setAttribute("aria-invalid", "true");
      return;
    }
    const spaced = /\s/.test(docText(view.state)[verse.numTo] ?? "");
    edit({
      changes: { from: verse.numFrom, to: verse.numTo, insert: spaced ? value : `${value} ` },
    });
  });
  dom.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
    view.focus();
  });

  const remove = button("Remove verse marker", () => {
    const doc = docText(view.state);
    if (doc[verse.markerFrom - 1] !== "\n")
      return edit({ changes: { from: verse.markerFrom, to: verse.contentFrom } });
    const empty = isEmptyVerse(structureAt(view.state), doc, k);
    edit({
      changes: { from: verse.markerFrom - 1, to: verse.contentFrom, insert: empty ? "" : " " },
    });
  });
  const add = button("Add verse after", () => {
    const at = verseEnd(structureAt(view.state), docText(view.state), k);
    const insert = `\n\\v ${nextNumber(verse.num)} `;
    edit({
      changes: { from: at, insert },
      selection: EditorSelection.cursor(at + insert.length),
    });
  });
  dom.append(form, remove, add);
  queueMicrotask(() => input.select());
  return { dom };
}

/** Whether a finding's only fix deletes this verse's marker, which Remove verse marker already does. */
export const removesMarker = new WeakMap<Diagnostic, { from: number; to: number }>();
const removesTheMarker = (diagnostic: Diagnostic, verse: VerseRow): boolean => {
  const removal = removesMarker.get(diagnostic);
  return removal !== undefined && removal.from === verse.markerFrom;
};

const sentenceCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const closeMenu = (view: EditorView): void => view.dispatch({ effects: openVerseMenu.of(null) });

/** The span a verse number owns: its marker, its digits, and the box of an empty one. */
const onNumber = (verse: VerseRow, from: number, to: number): boolean =>
  from === to
    ? from >= verse.markerFrom && from <= verse.contentFrom
    : from < verse.contentFrom && to > verse.markerFrom;

const findingsOnNumber = (
  state: EditorState,
  verse: VerseRow,
): { diagnostic: Diagnostic; from: number; to: number }[] => {
  const found: { diagnostic: Diagnostic; from: number; to: number }[] = [];
  forEachDiagnostic(state, (diagnostic, from, to) => {
    if (onNumber(verse, from, to)) found.push({ diagnostic, from, to });
  });
  return found;
};

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

/** A click on a verse number opens its menu; anywhere else closes it. */
const verseNumberClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!numbersHaveMenus(view.state) || !(event.target instanceof Element)) return false;
    if (event.target.closest(".usfm-verse-menu") !== null) return false;
    const number = event.target.closest(".usfm-num-v, .usfm-slot-v");
    if (number === null) {
      if (view.state.field(verseMenuField) !== null)
        view.dispatch({ effects: openVerseMenu.of(null) });
      return false;
    }
    const pos = view.posAtDOM(number);
    const k = structureAt(view.state).verses.findIndex(
      (verse) => verse.markerFrom <= pos && pos <= verse.contentFrom,
    );
    if (k < 0) return false;
    event.preventDefault();
    view.dispatch({ effects: openVerseMenu.of(k) });
    return true;
  },
});

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
  verseMenuField,
  verseNumberClicks,
];
