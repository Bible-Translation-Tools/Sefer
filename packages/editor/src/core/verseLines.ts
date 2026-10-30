import { isolateHistory } from "@codemirror/commands";
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
import {
  EditorView,
  type KeyBinding,
  type LayerMarker,
  layer,
  RectangleMarker,
} from "@codemirror/view";

import { docText, structureAt, type DocStructure } from "./docStructure";
import type { DocLine, VerseRow } from "./fold";
import { fromHost, isVisual, modeFacet, trusted } from "./kernel";
import { preferenceOn } from "./preferences";
import { assignmentAt, isContainerClass } from "./registry";
import { noteTr } from "./trace";

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
    // A verse ends at the next chapter: its `\\cp`, `\\ca` and heading are not the verse's.
    if (line.cls === "slot.c" && line.from >= verse.contentFrom) break;
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

/**
 * The first keystroke in an empty chapter's paragraph — where its empty state
 * (`emptyChapters`) shows "1 Click here to start editing…" — writes that verse:
 * `\\v 1` on its own line under the paragraph marker, then what was typed, in
 * place of the leftover markers the empty state was hiding.
 * Until then nothing is written; Refine and line by line alike.
 */
const typeIntoEmptyChapter = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || view.state.facet(modeFacet) !== "regular") return false;
  const doc = docText(view.state);
  const empty = emptyChapters(doc, structureAt(view.state)).find(
    (chapter) =>
      chapter.field !== undefined && from >= chapter.field.from && from <= chapter.field.to,
  );
  if (empty?.field === undefined) return false;
  let at = empty.field.from;
  while (doc[at - 1] === " " || doc[at - 1] === "\t") at--;
  const insert = `\n\\v 1 ${text}`;
  view.dispatch({
    changes: { from: at, to: empty.to, insert },
    selection: EditorSelection.cursor(at + insert.length),
    annotations: trusted.of("empty-chapter"),
    userEvent: "input.type",
    scrollIntoView: true,
  });
  return true;
});

/** What an emptied chapter holds after its heading: a paragraph and its first verse. */
const EMPTY_CHAPTER_BODY = "\n\\p\n\\v 1";

/**
 * A chapter always starts at verse 1. An edit that empties one — deleting all
 * its words, which leaves a bare `\\p` and `\\v` or less — writes it back as
 * `\\p` and `\\v 1` in the same step, so the file never holds a chapter
 * without its first verse, and the empty state (`emptyChapters`) stands on
 * it. Only chapters the edit touched: an empty chapter elsewhere is left as
 * it was opened.
 */
const emptiedChaptersKeepVerseOne = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.startState.facet(modeFacet) !== "regular") return tr;
  if (tr.annotation(trusted) === "empty-chapter") return tr;
  const doc = docText(tr.state);
  const touched: [number, number][] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => touched.push([fromB, toB]));
  const rewrite = emptyChapters(doc, structureAt(tr.state)).find(
    (chapter) =>
      doc.slice(chapter.at, chapter.to) !== EMPTY_CHAPTER_BODY &&
      touched.some(([from, to]) => from <= chapter.to && to >= chapter.at),
  );
  if (rewrite === undefined) return tr;
  return [
    tr,
    {
      changes: { from: rewrite.at, to: rewrite.to, insert: EMPTY_CHAPTER_BODY },
      selection: EditorSelection.cursor(rewrite.at + "\n\\p".length, -1),
      annotations: trusted.of("empty-chapter"),
      sequential: true,
    },
  ];
});

/**
 * In an empty chapter's paragraph the caret is drawn against what comes
 * before it — the waiting verse number — not after the ghost text that
 * shares its position, so it reads number, caret, "Click here…".
 */
const caretBesideEmptyChapterVerse = EditorState.transactionFilter.of((tr) => {
  if ((!tr.selection && !tr.docChanged) || tr.state.facet(modeFacet) !== "regular") return tr;
  const range = tr.newSelection.main;
  if (!range.empty) return tr;
  // Anywhere in an empty chapter's hidden leftovers — where deleting its
  // words leaves the caret — is its empty state's paragraph.
  const chapter = emptyChapters(docText(tr.state), structureAt(tr.state)).find(
    (c) => c.field !== undefined && range.head > c.at && range.head <= c.to,
  );
  if (chapter?.field === undefined) return tr;
  if (range.head === chapter.field.from && range.assoc === -1) return tr;
  return [tr, { selection: EditorSelection.cursor(chapter.field.from, -1), sequential: true }];
});

/** "1", "1.", "v1", "v 1", "verse 1" at the end of what is before the caret, as its own word. */
const TYPED_VERSE = /(^|\s)((?:verse\s*|v\s*)?(\d{1,3})\.?)$/i;
/** A marker (and its number) just before: `\\v 4 ` is USFM already, not a typed number. */
const MARKER_BEFORE = /\\[A-Za-z]+\d*(?:\s+[\d-]+)?\s*$/;
/** Just after `\\v N`, its own number again: the reader retyping what is shown. */
const SAME_VERSE_BEFORE = /\\v\s+(\d+)\s*$/;

/**
 * Verse numbers typed the way people write them without USFM — "1", "1.",
 * "v1", "v 1", "verse 1" — become a verse (`\\v N`) on the space after them,
 * but only for the verse that comes next in this chapter (the one after the
 * caret's verse, or 1 before any) and only when the chapter has no such verse
 * yet. "7000" in chapter 3, a number out of order, or "12" in "12 disciples"
 * at verse 4 stay words. Undo takes the verse back to what was typed. Refine
 * and line by line; USFM is typed as USFM.
 */
const typedVerseNumbers = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== " " || from !== to || view.state.facet(modeFacet) !== "regular") return false;
  if (!preferenceOn(view.state, "verseShortcuts")) return false;
  const line = view.state.doc.lineAt(from);
  const before = view.state.doc.sliceString(line.from, from);
  const typed = TYPED_VERSE.exec(before);
  if (typed === null) return false;
  const tokenFrom = line.from + typed.index + typed[1].length;
  const ahead = before.slice(0, tokenFrom - line.from);
  const number = Number(typed[3]);
  const same = SAME_VERSE_BEFORE.exec(ahead);
  if (same !== null && Number(same[1]) === number) {
    // "1 " typed straight after the `\\v 1` an empty chapter just wrote: already that verse.
    view.dispatch({
      changes: { from: tokenFrom, to: from },
      selection: EditorSelection.cursor(tokenFrom),
      userEvent: "input.type",
    });
    return true;
  }
  if (MARKER_BEFORE.test(ahead)) return false;
  const structure = structureAt(view.state);
  const chapter = structure.chapters.findLast((row) => row.from <= from);
  const start = chapter?.from ?? 0;
  const end = chapter?.to ?? view.state.doc.length;
  let previous = 0;
  for (const verse of structure.verses) {
    if (verse.markerFrom < start || verse.markerFrom > end) continue;
    const last = Number((verse.num ?? "").split("-").pop());
    if (Number.isFinite(last) && last === number) return false;
    if (verse.markerFrom < from && Number.isFinite(last)) previous = last;
  }
  if (number !== previous + 1) return false;
  const insert = `\\v ${number} `;
  view.dispatch({
    changes: { from: tokenFrom, to: from, insert },
    selection: EditorSelection.cursor(tokenFrom + insert.length),
    annotations: [trusted.of("typed-verse"), isolateHistory.of("before")],
    userEvent: "input.type.verse",
  });
  return true;
});

/** `cm-line-by-line` and `cm-number-menus` on the editor, for what the stylesheet does only there. */
const lineByLineClass = EditorView.editorAttributes.of((view) => {
  if (isVerseLines(view.state)) return { class: "cm-line-by-line cm-number-menus" };
  return numbersHaveMenus(view.state) ? { class: "cm-number-menus" } : null;
});

/**
 * Reading and line by line name each chapter once, on its `\\c` line. A
 * chapter's own label is any `\\cl` inside the chapter's span (the parse's
 * chapter rows), never "the line after `\\c`": with `\\c 2`, `\\s Heading`,
 * `\\cl Sura 2` the heading stays where it is and "Sura 2" names the chapter.
 * Only the `\\c` line and the label lines are hidden; the title is drawn on the
 * `\\c` line. A chapter with no label of its own is "Chapter 2", or the book's
 * label (`\\cl Psalm` before the first chapter) and the number.
 */
export interface ChapterTitle {
  /** The `\\c` line. */
  readonly line: DocLine;
  readonly number: string;
  /** Its own label's words, markup taken out: the first non-empty `\\cl` in its span. */
  readonly own?: string;
  /** Every `\\cl` line in its span. */
  readonly labels: readonly DocLine[];
}

export interface ChapterTitles {
  readonly bookLabel: string;
  readonly chapters: readonly ChapterTitle[];
}

/**
 * Each scan is kept per structure: one structure is one document, and the
 * filters below ask for the same chapters several times a keystroke.
 */
const titlesSeen = new WeakMap<DocStructure, ChapterTitles>();
const emptySeen = new WeakMap<DocStructure, readonly EmptyChapter[]>();

export const chapterTitles = (doc: string, structure: DocStructure): ChapterTitles => {
  const seen = titlesSeen.get(structure);
  if (seen !== undefined) return seen;
  const titles = scanChapterTitles(doc, structure);
  titlesSeen.set(structure, titles);
  return titles;
};

/** A label's words as a reader sees them: character markers taken out. */
const labelWords = (doc: string, line: DocLine): string =>
  doc
    .slice(line.contentFrom, line.to)
    .replace(/\\\+?[A-Za-z0-9]+(?:\*|[ \t]?)/g, "")
    .trim();

const scanChapterTitles = (doc: string, structure: DocStructure): ChapterTitles => {
  const rows = structure.chapters.filter((row) => row.label !== "");
  const lines = structure.lines;
  let bookLabel = "";
  const chapters: { line: DocLine; number: string; own?: string; labels: DocLine[] }[] = rows.map(
    (row) => ({ line: lines.at(lines.indexAt(row.from)), number: row.label, labels: [] }),
  );
  // One pass over the lines, the chapter rows in step: a label belongs to the row it is in.
  let k = -1;
  for (const line of lines) {
    while (k + 1 < rows.length && line.from >= rows[k + 1].from) k++;
    if (line.marker !== "cl") continue;
    const words = labelWords(doc, line);
    if (k < 0) {
      if (bookLabel === "") bookLabel = words;
      continue;
    }
    const chapter = chapters[k];
    chapter.labels.push(line);
    if (chapter.own === undefined && words !== "") chapter.own = words;
  }
  return { bookLabel, chapters };
};

/**
 * A chapter with nothing to see: after its `\\c` (and its own `\\cl`) only
 * markers and blank lines, up to the next chapter or the end. `at` is the end
 * of its heading's last line, where the empty state is drawn and where a
 * click starts the text; `title` is how the chapter is named on screen — its
 * own label, else the book's label and the number; absent when neither is
 * there, and the host's word for "Chapter" names it with `number`.
 */
export interface EmptyChapter {
  readonly at: number;
  readonly title?: string;
  readonly number: string;
  /** Where its leftover markers end: the newline before the next chapter, or the end. */
  readonly to: number;
  /**
   * Its first leftover paragraph, where the caret already sits: `line` where
   * its marker starts, `from` where its text would go, `to` its line's end. Absent when nothing follows the heading.
   */
  readonly field?: { readonly line: number; readonly from: number; readonly to: number };
}

/**
 * Text left once markers and whitespace are taken out — a verse marker with
 * its number, too: deleting a chapter's words leaves `\\v 1` behind, and that
 * "1" is the marker's, not text anyone wrote.
 */
const VISIBLE = /\\v[ \t]+[\w-]*|\\[A-Za-z0-9]+\*?|\s+/g;

export const emptyChapters = (doc: string, structure: DocStructure): readonly EmptyChapter[] => {
  const seen = emptySeen.get(structure);
  if (seen !== undefined) return seen;
  const found = scanEmptyChapters(doc, structure);
  emptySeen.set(structure, found);
  return found;
};

const scanEmptyChapters = (doc: string, structure: DocStructure): readonly EmptyChapter[] => {
  const { bookLabel, chapters } = chapterTitles(doc, structure);
  const found: EmptyChapter[] = [];
  chapters.forEach((chapter, k) => {
    const line = chapter.line;
    const end = chapters[k + 1]?.line.from ?? doc.length;
    const number = chapter.number;
    // The heading ends with the last of its lines: the `\\c`, then its own labels.
    const at = Math.max(line.to, ...chapter.labels.map((label) => label.to));
    const title = chapter.own ?? (bookLabel === "" ? undefined : `${bookLabel} ${number}`);
    const to = end < doc.length ? Math.max(at, end - 1) : end;
    if (doc.slice(at, end).replace(VISIBLE, "") !== "") return;
    let field: EmptyChapter["field"];
    for (let i = 0; i < structure.blocks.length; i++) {
      const from = structure.blocks.fromAt(i);
      if (from <= at) continue;
      if (from > to) break;
      // A paragraph, not a heading or a section mark (`\\s5`): the ghost takes
      // the indent a verse at a paragraph's start would have.
      if (structure.blocks.clsAt(i) !== "block.para") continue;
      const block = structure.blocks.at(i);
      const lineEnd = doc.indexOf("\n", block.contentFrom);
      field = {
        line: from,
        from: block.contentFrom,
        to: lineEnd < 0 || lineEnd > to ? to : lineEnd,
      };
      break;
    }
    found.push({
      at,
      number,
      to,
      ...(title === undefined ? {} : { title }),
      ...(field === undefined ? {} : { field }),
    });
  });
  return found;
};

/**
 * Each chapter's heading lines — its `\\c` line and its own `\\cl` lines — one
 * range each, in order. Whatever stands between them (a section heading) is
 * the text's, not the title's.
 */
const chapterHeadings = (
  doc: string,
  structure: DocStructure,
): readonly { readonly from: number; readonly to: number }[] =>
  chapterTitles(doc, structure)
    .chapters.flatMap((chapter) => [chapter.line, ...chapter.labels])
    .map((line) => ({ from: line.from, to: line.to }))
    .sort((x, y) => x.from - y.from);

/** Past every heading line the caret is on or runs into, forward or back. */
const pastHeadings = (
  headings: readonly { readonly from: number; readonly to: number }[],
  pos: number,
  forward: boolean,
  length: number,
): number => {
  let at = pos;
  for (;;) {
    const on = headings.find((h) => at >= h.from && at <= h.to);
    if (on === undefined) return at;
    at = forward ? Math.min(length, on.to + 1) : Math.max(0, on.from - 1);
    if (at === 0 || at === length) return at;
  }
};

/**
 * A chapter's title is the book's, not the text's: set in its front matter
 * (`\\c`, `\\cl`), shown here, edited elsewhere — USFM for now. So in Refine
 * and line by line the caret passes over a heading in the direction of travel
 * (to the line after it, or the end of the line before), and an edit that
 * would touch it — typing in it, deleting into it, or deleting the line break
 * either side, which would run it into the text — is refused. An empty
 * chapter's hidden leftovers are refused the same way: there is nothing there
 * to delete, and deleting into them reached the title.
 */
// "project.chapterLabels" is Sefer's chapter labels dialog, the one place labels are written.
const HEADING_WRITERS = new Set([
  "empty-chapter",
  "typed-verse",
  "frontmatter",
  "canonical",
  "project.chapterLabels",
]);

const chapterHeadingsAreFixed = EditorState.transactionFilter.of((tr) => {
  if (tr.startState.facet(modeFacet) !== "regular") return tr;
  // Trusted edits pass only from what writes headings or empty chapters on
  // purpose; a guarded Backspace is trusted too, and is exactly what must not reach a title.
  // A host's trusted apply (an import, a Review apply, a recovery) was
  // previewed or decided whole, and replaces headings as the person chose.
  const seal = tr.annotation(trusted);
  if (seal !== undefined && HEADING_WRITERS.has(seal)) return tr;
  if (tr.annotation(fromHost) === true) return tr;
  const doc = docText(tr.startState);
  const structure = structureAt(tr.startState);
  const headings = chapterHeadings(doc, structure);
  if (
    tr.docChanged &&
    (tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("move"))
  ) {
    const fixed = [
      ...headings.map((h) => ({
        from: Math.max(0, h.from - 1),
        to: Math.min(doc.length, h.to + 1),
      })),
      ...emptyChapters(doc, structure).map((c) => ({ from: c.at, to: c.to })),
    ];
    let touches = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      for (const r of fixed)
        if (fromA === toA ? fromA > r.from && fromA < r.to : fromA < r.to && toA > r.from)
          touches = true;
    });
    if (touches) {
      noteTr(tr, {
        rule: "chapterHeadingsAreFixed",
        verdict: "refused",
        detail: "the edit touches a chapter's heading, which only its own writers change",
      });
      return [];
    }
  }
  if (!tr.selection) return tr;
  const range = tr.selection.main;
  if (!range.empty) return tr;
  const after = docText(tr.state);
  const landed = chapterHeadings(after, structureAt(tr.state));
  const heading = landed.find((h) => range.head >= h.from && range.head <= h.to);
  if (heading === undefined) return tr;
  // A click on a title, or arriving from above, goes on into the chapter —
  // past every heading line, to its empty state's paragraph when it has
  // nothing yet; from below, back to the end of the line before.
  const before = tr.startState.selection.main.head;
  const forward = tr.isUserEvent("select.pointer") || before <= heading.from;
  const past = pastHeadings(landed, range.head, forward, after.length);
  const field = forward
    ? emptyChapters(after, structureAt(tr.state)).find(
        (c) => past === Math.min(after.length, c.at + 1),
      )?.field
    : undefined;
  const pos = field?.from ?? past;
  return [tr, { selection: EditorSelection.cursor(pos), sequential: true }];
});

/**
 * What a click on a chapter's title does, from the host: Sefer opens its
 * chapter labels dialog there. While it `wants` the title, the press is its
 * and the caret stays put; the action runs on the release (`titlesAreTheHosts`).
 */
export interface ChapterTitleAction {
  readonly wants: () => boolean;
  readonly run: () => void;
}

export const chapterTitleAction = Facet.define<ChapterTitleAction, ChapterTitleAction | undefined>({
  combine: (values) => values[0],
});

/** The words of a chapter's title: the hover underline's selectors in editor.css. */
const TITLE_WORDS = ".usfm-chap-label, .usfm-chap-named .usfm-num-c";

/** Views whose last press landed on a chapter's title the host wants: the release runs it. */
const titlePressed = new WeakSet<EditorView>();

/**
 * The release of a press on a title runs the host's action. The release, not
 * the click: the line can be redrawn between press and release, and then the
 * browser sends no click; and the release comes after the pointer-up a dialog
 * listens for, so the dialog it opens stays open.
 */
/** `cm-titles-open` while the host wants presses on titles: the stylesheet shows them as links. */
const titlesOpenClass = EditorView.editorAttributes.of((view) =>
  view.state.facet(modeFacet) === "regular" &&
  view.state.facet(chapterTitleAction)?.wants() === true
    ? { class: "cm-titles-open" }
    : null,
);

const titlesAreTheHosts = EditorView.domEventHandlers({
  mouseup(_event, view) {
    if (!titlePressed.has(view)) return false;
    titlePressed.delete(view);
    view.state.facet(chapterTitleAction)?.run();
    return true;
  },
});

/**
 * The room above a chapter's title is the title line's own padding, so a
 * press there would land on the heading and be carried on into the new
 * chapter. It belongs to the chapter before: the caret goes to the line just
 * above the title, where the press was across it. Only a press on the title
 * itself goes on into its chapter (`chapterHeadingsAreFixed`).
 */
const pressesAboveTitlesStayBehind = EditorView.domEventHandlers({
  mousedown(event, view) {
    titlePressed.delete(view);
    if (event.button !== 0 || view.state.facet(modeFacet) !== "regular") return false;
    const target = event.target instanceof Element ? event.target : null;
    const line = target?.closest(".usfm-chap");
    if (line === null || line === undefined || !view.contentDOM.contains(line)) return false;
    const box = line.getBoundingClientRect();
    const titleTop = box.top + parseFloat(getComputedStyle(line).paddingTop);
    if (event.clientY >= titleTop) {
      // The title's words themselves, what underlines on hover (editor.css,
      // `cm-titles-open`), are the host's when it wants them
      // (`titlesAreTheHosts`); the rest of the line is only a line.
      if (target?.closest(TITLE_WORDS) == null) return false;
      const action = view.state.facet(chapterTitleAction);
      if (action === undefined || !action.wants()) return false;
      event.preventDefault();
      titlePressed.add(view);
      return true;
    }
    const at = view.posAtDOM(line);
    const heading = chapterHeadings(docText(view.state), structureAt(view.state)).find(
      (h) => at >= h.from && at <= h.to,
    );
    if (heading === undefined) return false;
    const above = view.posAtCoords({ x: event.clientX, y: box.top - 2 });
    const pos = above !== null && above < heading.from ? above : Math.max(0, heading.from - 1);
    event.preventDefault();
    view.dispatch({ selection: EditorSelection.cursor(pos), userEvent: "select" });
    view.focus();
    return true;
  },
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
  update: (update) => {
    const moved =
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      assignmentAt(update.startState).verseLines !== assignmentAt(update.state).verseLines;
    if (moved) boxesMeasured.delete(update.view);
    return moved || update.selectionSet || update.focusChanged;
  },
  markers: (view) => {
    if (!isVerseLines(view.state)) return [];
    const caretVerse = verseIndexAt(structureAt(view.state), view.state.selection.main.head);
    // The caret moved and nothing else: the same boxes, the ring on another.
    const measured = boxesMeasured.get(view) ?? measureBoxes(view);
    // Nothing measured yet (no verse line drawn) is asked again next time.
    if (measured.length > 0) boxesMeasured.set(view, measured);
    return measured.map(
      ({ k, left, top, width, height }) =>
        new VerseBox(left, top, width, height, k === caretVerse && view.hasFocus),
    );
  },
});

/**
 * The selection, drawn inside the verse's box. CodeMirror's own spans a
 * wrapped line edge to edge of the editor, past the box on both sides; this
 * draws the same rectangles cut to the text's column, and the stylesheet
 * hides CodeMirror's here. A selection never leaves its verse
 * (`selectionStaysInVerse`), so one column fits it.
 */
const verseSelection = layer({
  above: false,
  class: "usfm-verse-selection",
  update: (update) =>
    update.docChanged ||
    update.selectionSet ||
    update.viewportChanged ||
    update.geometryChanged ||
    update.focusChanged,
  markers: (view) => {
    if (!isVerseLines(view.state) || view.state.selection.ranges.every((r) => r.empty)) return [];
    const sample = view.contentDOM.querySelector<HTMLElement>(".usfm-verse-line");
    if (sample === null) return [];
    const style = getComputedStyle(sample);
    const line = sample.getBoundingClientRect();
    const scroller = view.scrollDOM.getBoundingClientRect();
    const baseLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
    const columnLeft = (line.left + parseFloat(style.paddingLeft) - baseLeft) / view.scaleX;
    const columnRight = (line.right - parseFloat(style.paddingRight) - baseLeft) / view.scaleX;
    const cut: RectangleMarker[] = [];
    for (const range of view.state.selection.ranges) {
      if (range.empty) continue;
      for (const rect of RectangleMarker.forRange(view, "cm-selectionBackground", range)) {
        const left = Math.max(rect.left, columnLeft);
        const right = Math.min(
          rect.width === null ? columnRight : rect.left + rect.width,
          columnRight,
        );
        if (right > left)
          cut.push(
            new RectangleMarker(
              "cm-selectionBackground",
              left,
              rect.top,
              right - left,
              rect.height,
            ),
          );
      }
    }
    return cut;
  },
});

interface MeasuredBox {
  readonly k: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The boxes as last measured, per view, until the text, the viewport, the
 * geometry or the mode changes. Measuring reads layout, so a caret move that
 * re-measured every visible verse cost a layout a keystroke.
 */
const boxesMeasured = new WeakMap<EditorView, readonly MeasuredBox[]>();

const measureBoxes = (view: EditorView): readonly MeasuredBox[] => {
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
  const { from: shownFrom, to: shownTo } = view.viewport;
  const rects: { k: number; left: number; top: number; width: number; bottom: number }[] = [];
  for (let k = 0; k < structure.verses.length; k++) {
    const verse = structure.verses[k];
    if (verse.markerFrom > shownTo) break;
    // Ended before the viewport: `verseEnd` walks the lines, so it is asked only near it.
    if ((structure.verses[k + 1]?.markerFrom ?? Infinity) < shownFrom) continue;
    const end = Math.max(verseEnd(structure, doc, k), verse.contentFrom);
    if (end < shownFrom) continue;
    const start = view.coordsAtPos(verse.markerFrom, 1);
    const last = view.coordsAtPos(end, -1);
    if (start === null || last === null) continue;
    const left = lineBox.left + hang - pad;
    const right = lineBox.right;
    rects.push({
      k,
      left: (left - baseLeft) / view.scaleX,
      top: (start.top - pad - baseTop) / view.scaleY,
      width: (right - left) / view.scaleX,
      bottom: (Math.max(last.bottom, start.bottom) + pad - baseTop) / view.scaleY,
    });
  }
  // A verse that starts mid-line in the file sits closer to the one before;
  // its neighbour's box stops short so the two never touch.
  return rects.map((rect, i) => {
    const next = rects[i + 1];
    const bottom = next === undefined ? rect.bottom : Math.min(rect.bottom, next.top - gap);
    return {
      k: rect.k,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: bottom - rect.top,
    };
  });
};

/** Everything line-by-line adds besides its keys and its layout. */
export const verseLineBehaviour: Extension = [
  lineByLineClass,
  // Before the boxes: CodeMirror stacks a layer under the text higher the earlier it comes.
  verseSelection,
  verseBoxes,
  chapterHeadingsAreFixed,
  pressesAboveTitlesStayBehind,
  titlesAreTheHosts,
  titlesOpenClass,
  emptiedChaptersKeepVerseOne,
  typeIntoEmptyChapter,
  caretBesideEmptyChapterVerse,
  typedVerseNumbers,
  typeIntoEmptyVerse,
  labelsStayPut,
  pasteAsOneLine,
  selectionStaysInVerse,
];
