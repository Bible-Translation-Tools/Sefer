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
import { EditorView, type KeyBinding, type LayerMarker, layer } from "@codemirror/view";

import { docText, structureAt, type DocStructure } from "./docStructure";
import type { DocLine, VerseRow } from "./fold";
import { isVisual, trusted } from "./kernel";
import { assignmentAt, isContainerClass } from "./registry";

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

/** What line by line leaves as Reading draws it: the blocks, and the spans their lines cover. */
export interface KeptAsReading {
  readonly blocks: ReadonlySet<number>;
  readonly spans: readonly { readonly from: number; readonly to: number }[];
}

/**
 * A table's rows and a sidebar with everything in it: a verse runs on past
 * them, so they cannot be joined into one, and they keep their own lines.
 */
export function keptAsReading(structure: DocStructure): KeptAsReading {
  const blocks = new Set<number>();
  const spans: { from: number; to: number }[] = [];
  let containerTo = -1;
  for (let i = 0; i < structure.blocks.length; i++) {
    const cls = structure.blocks.clsAt(i);
    const from = structure.blocks.fromAt(i);
    const to = structure.blocks.toAt(i);
    if (isContainerClass(cls)) containerTo = Math.max(containerTo, to);
    if (cls !== "table" && !isContainerClass(cls) && from >= containerTo) continue;
    blocks.add(i);
    const last = spans[spans.length - 1];
    if (last !== undefined && from <= last.to + 1) last.to = Math.max(last.to, to);
    else spans.push({ from, to });
  }
  return { blocks, spans };
}

/**
 * Headings and chapter numbers show as labels here, and tables and sidebars as
 * Reading draws them: read-only, changed in Reading or USFM.
 */
const labelsStayPut = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged || !isVerseLines(tr.startState) || tr.annotation(trusted) !== undefined)
    return true;
  const ranges: number[] = [];
  const structure = structureAt(tr.startState);
  for (const line of structure.lines)
    if (line.cls === "block.heading" || line.cls === "slot.c") ranges.push(line.from, line.to);
  for (const span of keptAsReading(structure).spans) ranges.push(span.from, span.to);
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

/**
 * Line by line names each chapter once. A chapter with its own label (`\\c 2`
 * then `\\cl Icipandwa 2`, before its first verse) is titled by the label and its
 * number's line is folded away: `folds` runs from the `\\c` line's start to the
 * label's line. Any other chapter is `named`: "Chapter 2", or the book's label
 * (`\\cl Psalm` before the first chapter) and the number.
 */
export interface ChapterTitles {
  readonly bookLabel: string;
  readonly named: readonly DocLine[];
  /** `to` is the label's line; `label` where its words start. */
  readonly folds: readonly { readonly from: number; readonly to: number; readonly label: number }[];
}

export const chapterTitles = (doc: string, structure: DocStructure): ChapterTitles => {
  const verseStarts = new Set(structure.verses.map((verse) => verse.markerFrom));
  const opensVerse = (line: DocLine): boolean =>
    verseStarts.has(line.contentFrom) || verseStarts.has(line.from);
  const labelOf = (line: DocLine): string => doc.slice(line.contentFrom, line.to).trim();
  let bookLabel = "";
  const named: DocLine[] = [];
  const folds: { from: number; to: number; label: number }[] = [];
  // One pass: a chapter waits for its own label until its first verse or the next chapter.
  let open: DocLine | null = null;
  let seenChapter = false;
  const settle = (): void => {
    if (open !== null) named.push(open);
    open = null;
  };
  for (const line of structure.lines) {
    if (line.cls === "slot.c") {
      settle();
      open = line;
      seenChapter = true;
    } else if (line.marker === "cl" && labelOf(line) !== "") {
      if (!seenChapter) bookLabel = labelOf(line);
      else if (open !== null) {
        folds.push({ from: open.from, to: line.from, label: line.contentFrom });
        open = null;
      }
    } else if (opensVerse(line)) settle();
  }
  settle();
  return { bookLabel, named, folds };
};

/**
 * What cannot be seen cannot hold the caret: a folded chapter line is passed
 * over in the direction of travel, to the label it folds into or back to the
 * line before. The caret's stops (`stops.ts`) know only the book's structure,
 * not line by line's drawing, so this catches what they let through.
 */
const caretSkipsFoldedChapters = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || !isVerseLines(tr.state)) return tr;
  const range = tr.selection.main;
  if (!range.empty) return tr;
  const { folds } = chapterTitles(docText(tr.state), structureAt(tr.state));
  const fold = folds.find((f) => range.head > f.from && range.head < f.label);
  if (fold === undefined) return tr;
  const before = tr.startState.selection.main.head;
  const pos = before <= fold.from ? fold.label : Math.max(0, fold.from - 1);
  return [tr, { selection: EditorSelection.cursor(pos), sequential: true }];
});

/** One verse's box, in the layer's coordinates. */
class VerseBox implements LayerMarker {
  constructor(
    private readonly left: number,
    private readonly top: number,
    private readonly width: number,
    private readonly height: number,
    private readonly active: boolean,
  ) {}
  eq(other: VerseBox): boolean {
    return (
      this.left === other.left &&
      this.top === other.top &&
      this.width === other.width &&
      this.height === other.height &&
      this.active === other.active
    );
  }
  draw(): HTMLElement {
    const box = document.createElement("div");
    box.className = this.active ? "usfm-verse-box usfm-verse-box-active" : "usfm-verse-box";
    this.update(box);
    return box;
  }
  update(box: HTMLElement): boolean {
    box.className = this.active ? "usfm-verse-box usfm-verse-box-active" : "usfm-verse-box";
    Object.assign(box.style, {
      left: `${this.left}px`,
      top: `${this.top}px`,
      width: `${this.width}px`,
      height: `${this.height}px`,
    });
    return true;
  }
}

/**
 * Line by line draws each verse's text inside a box, its number outside to the
 * left: a touch target the size of the verse, not of its words. Cosmetic: the
 * boxes sit behind the text in a layer, so a verse that starts mid-line in the
 * file gets its own box and nothing is written.
 */
const verseBoxes = layer({
  above: false,
  class: "usfm-verse-boxes",
  update: (update) =>
    update.docChanged ||
    update.selectionSet ||
    update.viewportChanged ||
    update.geometryChanged ||
    update.focusChanged ||
    assignmentAt(update.startState).verseLines !== assignmentAt(update.state).verseLines,
  markers: (view) => {
    if (!isVerseLines(view.state)) return [];
    const structure = structureAt(view.state);
    const doc = docText(view.state);
    const scroller = view.scrollDOM.getBoundingClientRect();
    const baseLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
    const baseTop = scroller.top - view.scrollDOM.scrollTop * view.scaleY;
    const sample = view.contentDOM.querySelector<HTMLElement>(".usfm-verse-line");
    if (sample === null) return [];
    const style = getComputedStyle(sample);
    const hang = parseFloat(style.paddingInlineStart);
    const pad = parseFloat(style.getPropertyValue("--verse-box-pad")) || 24;
    const gap = parseFloat(style.getPropertyValue("--verse-box-gap")) || 8;
    const lineBox = sample.getBoundingClientRect();
    const caret = view.state.selection.main.head;
    const caretVerse = verseIndexAt(structure, caret);
    const { from: shownFrom, to: shownTo } = view.viewport;
    const rects: { left: number; top: number; width: number; bottom: number; active: boolean }[] =
      [];
    for (let k = 0; k < structure.verses.length; k++) {
      const verse = structure.verses[k];
      const end = Math.max(verseEnd(structure, doc, k), verse.contentFrom);
      if (end < shownFrom || verse.markerFrom > shownTo) continue;
      const start = view.coordsAtPos(verse.markerFrom, 1);
      const last = view.coordsAtPos(end, -1);
      if (start === null || last === null) continue;
      const left = lineBox.left + hang - pad;
      const right = lineBox.right;
      rects.push({
        left: (left - baseLeft) / view.scaleX,
        top: (start.top - pad - baseTop) / view.scaleY,
        width: (right - left) / view.scaleX,
        bottom: (Math.max(last.bottom, start.bottom) + pad - baseTop) / view.scaleY,
        active: k === caretVerse && view.hasFocus,
      });
    }
    // A verse that starts mid-line in the file sits closer to the one before;
    // its neighbour's box stops short so the two never touch.
    return rects.map((rect, i) => {
      const next = rects[i + 1];
      const bottom = next === undefined ? rect.bottom : Math.min(rect.bottom, next.top - gap);
      return new VerseBox(rect.left, rect.top, rect.width, bottom - rect.top, rect.active);
    });
  },
});

/** Everything line-by-line adds besides its keys and its layout. */
export const verseLineBehaviour: Extension = [
  lineByLineClass,
  verseBoxes,
  caretSkipsFoldedChapters,
  typeIntoEmptyVerse,
  labelsStayPut,
  pasteAsOneLine,
  selectionStaysInVerse,
];
