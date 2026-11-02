import {
  EditorSelection,
  type EditorState,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";

import { blockAt, isVisual, nl, trusted } from "../kernel";
import { structureAt, type Block, type DocStructure } from "../model/docStructure";
import { assignmentAt } from "../model/registry";
import { preferenceOf } from "../preferences";

/**
 * Poetry levels in Refine, the way Word indents a list: Tab moves the line one
 * level in (`\p` → `\q1` → `\q2`), Shift-Tab and Backspace at a poetry line's
 * start one level out, and Enter on an empty poetry line leaves poetry. Only the
 * line's marker is rewritten; no tab character is ever written.
 *
 * "A line" is the block the caret is in, whole, wherever in it the caret
 * sits; a selection changes every block it touches. Level 3 and 4 exist only
 * in a book that already has a `\q3` or `\q4`. USFM mode keeps raw Tab, and
 * Form Mode and tables keep their own (they are bound ahead of this).
 */

const FLOOR = "p";
const BASE_MAX = 2;

/** A block's level: 0 for the paragraph floor, n for `\qn` (`\q` is 1); null for any other kind. */
const levelOf = (kind: string): number | null => {
  if (kind === FLOOR) return 0;
  const q = /^q([1-4]?)$/.exec(kind);
  if (q === null) return null;
  return q[1] === "" ? 1 : Number(q[1]);
};

/**
 * The book's habits: its deepest level in use, and whether it spells level 1
 * bare (`\q`). One scan per document, kept with its structure: Tab and the
 * line menu ask on every press.
 */
interface Habits {
  readonly max: number;
  readonly bare: boolean;
  /** How the book spells a section heading: `s` if it writes it bare, else `s1`. */
  readonly section: string;
}

const habitsSeen = new WeakMap<DocStructure, Habits>();

const bookHabits = (structure: DocStructure): Habits => {
  const seen = habitsSeen.get(structure);
  if (seen !== undefined) return seen;
  let deepest = 0;
  let bare = false;
  let bareSection = false;
  const blocks = structure.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const kind = blocks.at(i).kind;
    if (kind === "q") bare = true;
    if (kind === "s") bareSection = true;
    deepest = Math.max(deepest, levelOf(kind) ?? 0);
  }
  const habits = { max: Math.max(BASE_MAX, deepest), bare, section: bareSection ? "s" : "s1" };
  habitsSeen.set(structure, habits);
  return habits;
};

const spell = (level: number, bare: boolean): string =>
  level === 0 ? FLOOR : level === 1 && bare ? "q" : `q${level}`;

/** Refine only: not USFM, not Form Mode. */
const inRefine = (state: EditorState): boolean =>
  isVisual(state) && !assignmentAt(state).verseLines;

/** The blocks a selection touches, each once, in order. */
const touchedBlocks = (state: EditorState, structure: DocStructure): Block[] => {
  const seen = new Set<number>();
  const out: Block[] = [];
  for (const range of state.selection.ranges) {
    for (const pos of [range.from, range.to]) {
      const b = blockAt(structure, pos);
      if (b !== null && !seen.has(b.from)) {
        seen.add(b.from);
        out.push(b);
      }
    }
    const blocks = structure.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const at = blocks.fromAt(i);
      if (at > range.from && at < range.to && !seen.has(at)) {
        seen.add(at);
        out.push(blocks.at(i));
      }
    }
  }
  return out.sort((a, b) => a.from - b.from);
};

/** Rewrites only the marker's name: `\q1` → `\q2`, its spacing and words untouched. */
const remark = (b: Block, kind: string) => {
  const from = b.lines[0]?.from ?? b.from;
  return { from: from + 1, to: from + 1 + b.kind.length, insert: kind };
};

/**
 * One verse at a time (SEFER-72): a line holding several verses is split
 * so only the verse at `pos` changes kind. Its stretch runs from its `\v`
 * (or the line's start) to the next `\v`; the verses after it reopen in the
 * line's old kind. A line of one verse, or none, is renamed whole.
 */
const verseCuts = (state: EditorState, structure: DocStructure, b: Block): number[] =>
  structure.verses
    .map((verse) => verse.markerFrom)
    .filter(
      (at) =>
        at > b.contentFrom && at < b.to && state.doc.sliceString(b.contentFrom, at).trim() !== "",
    );

/** Where the verse at `pos` starts in its line: its `\v`, or the line's content. */
const verseStart = (state: EditorState, structure: DocStructure, b: Block, pos: number): number =>
  verseCuts(state, structure, b).findLast((at) => at <= pos) ?? b.contentFrom;

const restyle = (
  state: EditorState,
  structure: DocStructure,
  b: Block,
  pos: number,
  kind: string,
) => {
  const cuts = verseCuts(state, structure, b);
  const start = cuts.findLast((at) => at <= pos);
  const end = cuts.find((at) => at > pos);
  /** A new line before `at`, in place of the spaces that ran up to it. */
  const breakAt = (at: number, marker: string) => {
    let from = at;
    while (from > b.contentFrom && /\s/.test(state.doc.sliceString(from - 1, from))) from--;
    return { from, to: at, insert: `${nl(state)}\\${marker} ` };
  };
  const changes = [start === undefined ? remark(b, kind) : breakAt(start, kind)];
  if (end !== undefined) changes.push(breakAt(end, b.kind));
  return changes;
};

const shift =
  (step: 1 | -1): StateCommand =>
  ({ state, dispatch }) => {
    if (!inRefine(state)) return false;
    const structure = structureAt(state);
    const sel = state.selection;
    const caret = sel.ranges.length === 1 && sel.main.empty ? sel.main.from : null;
    const changes = [];
    for (const b of touchedBlocks(state, structure)) {
      const level = levelOf(b.kind);
      const head = b.lines[0];
      if (level === null || head === undefined || head.marker === null) continue;
      const { max, bare } = bookHabits(structure);
      const next = Math.min(max, Math.max(0, level + step));
      if (next === level) continue;
      const kind = spell(next, bare);
      // A caret moves its own verse; a selection moves the lines it covers.
      if (caret === null) changes.push(remark(b, kind));
      else changes.push(...restyle(state, structure, b, caret, kind));
    }
    // Tab never leaves the editor or writes a tab, even where it changes nothing.
    if (changes.length === 0) return true;
    dispatch(
      state.update({
        changes,
        annotations: trusted.of("poetry-level"),
        userEvent: "input.usfm.reparent",
        scrollIntoView: true,
      }),
    );
    return true;
  };

/** Before a line's first word: nothing, or only the verse number that opens it. */
const NO_WORDS_YET = /^\s*(\\v([ \t]+[\w-]*)?[ \t]*)?$/;

/** Enter on an empty poetry line (a verse number alone still counts as empty) leaves poetry: `\q2` → `\p`. */
const stepOutOfEmptyPoetry: StateCommand = ({ state, dispatch }) => {
  if (!inRefine(state)) return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const structure = structureAt(state);
  const b = blockAt(structure, sel.from);
  if (b === null) return false;
  const level = levelOf(b.kind);
  if (level === null || level === 0) return false;
  if (!NO_WORDS_YET.test(state.doc.sliceString(b.contentFrom, b.to))) return false;
  dispatch(
    state.update({
      changes: remark(b, FLOOR),
      annotations: trusted.of("poetry-level"),
      userEvent: "input.usfm.reparent",
      scrollIntoView: true,
    }),
  );
  return true;
};

/**
 * Backspace at the very start of a poetry line steps out one level, as Word
 * takes a list's indent off before it joins lines: `\q2` → `\q1` → `\p`,
 * and only then does Backspace join the line above (SEFER-72). "The start" is anywhere before the
 * line's first word: before, inside or after a verse number opening the line.
 */
const stepOutAtLineStart: StateCommand = ({ state, dispatch }) => {
  if (!inRefine(state)) return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const structure = structureAt(state);
  const b = blockAt(structure, sel.from);
  if (b === null || sel.from < b.contentFrom) return false;
  const level = levelOf(b.kind);
  if (level === null || level === 0) return false;
  const before = state.doc.sliceString(verseStart(state, structure, b, sel.from), sel.from);
  if (!NO_WORDS_YET.test(before)) return false;
  const { bare } = bookHabits(structure);
  dispatch(
    state.update({
      changes: restyle(state, structure, b, sel.from, spell(level - 1, bare)),
      annotations: trusted.of("poetry-level"),
      userEvent: "input.usfm.reparent",
      scrollIntoView: true,
    }),
  );
  return true;
};

/**
 * Spaces at a line's start make it poetry, as Tab does (SEFER-72): the Space
 * that makes `indentSpaces` (a preference, 4 by default, 0 never), with the
 * others already typed before the line's first word, takes them out and moves
 * the line one level in. Backspace then steps it back out a level, as at any
 * poetry line's start (`stepOutAtLineStart`).
 */
/** Before the caret on its line: an opening verse number if any, then only spaces. */
const SPACES_BEFORE = /^(\s*\\v[ \t]+[\w-]*[ \t])?( *)$/;

const indentBySpaces: StateCommand = ({ state, dispatch }) => {
  if (!inRefine(state)) return false;
  const wanted = preferenceOf(state, "indentSpaces");
  if (wanted < 1) return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const structure = structureAt(state);
  const b = blockAt(structure, sel.from);
  if (b === null || sel.from < b.contentFrom || b.lines[0]?.marker == null) return false;
  const level = levelOf(b.kind);
  if (level === null) return false;
  const start = verseStart(state, structure, b, sel.from);
  const spaces = SPACES_BEFORE.exec(state.doc.sliceString(start, sel.from))?.[2];
  // This Space is the last of them: the others are typed already.
  if (spaces === undefined || spaces.length < wanted - 1) return false;
  const { max, bare } = bookHabits(structure);
  const next = Math.min(max, level + 1);
  // Already as deep as the book goes: the spaces are just spaces.
  if (next === level) return false;
  const from = sel.from - spaces.length;
  const changes = state.changes([
    ...restyle(state, structure, b, sel.from, spell(next, bare)),
    { from, to: sel.from },
  ]);
  dispatch(
    state.update({
      changes,
      selection: EditorSelection.cursor(changes.mapPos(sel.from)),
      annotations: trusted.of("poetry-level"),
      userEvent: "input.usfm.reparent",
      scrollIntoView: true,
    }),
  );
  return true;
};

/** The commands, by id; their keys are `keymaps.ts`'s. */
export const poetryLevelCommands = {
  "poetry.indentBySpaces": indentBySpaces,
  "poetry.leaveAtLineStart": stepOutAtLineStart,
  "poetry.indent": shift(1),
  "poetry.outdent": shift(-1),
  "poetry.leaveEmptyLine": stepOutOfEmptyPoetry,
};

/**
 * The kinds a line can be from its menu: a paragraph flush (`\m`) or indented
 * (`\p`), and the poetry levels the book allows; no list items (Will,
 * 2026-10-29). Lines of the wider family (`\pi`, `\li`) can be turned into
 * them, and so can a heading; a line with no verse in it can also become a
 * section heading. Each is one marker name for another, so the words never move.
 */
const TURNABLE = new Set(["p", "m", "pi", "q", "q1", "q2", "q3", "q4", "li", "li1"]);

/**
 * Headings a line can be turned back from (SEFER-72): section (`\s`, `\s1`–`\s3`),
 * parallel reference (`\r`), descriptive title (`\d`) and speaker (`\sp`).
 */
const HEADINGS = new Set(["s", "s1", "s2", "s3", "r", "d", "sp"]);

/** A verse cannot sit inside a heading, so only a line with no `\v` may become one. */
const HAS_VERSE = /\\v[ \t]/;

export interface LineKind {
  /** The block's marker as written (`q`, `q1`, `p`, `s1`). */
  readonly kind: string;
  /** What it can be turned into here, current one included; empty when it cannot. */
  readonly choices: readonly string[];
}

/** The line at an offset and what it may become; null off any block or outside Refine. */
export function lineKindAt(state: EditorState, offset: number): LineKind | null {
  if (!inRefine(state)) return null;
  const structure = structureAt(state);
  const b = blockAt(structure, offset);
  if (b === null || b.lines[0]?.marker == null) return null;
  if (!TURNABLE.has(b.kind) && !HEADINGS.has(b.kind)) return { kind: b.kind, choices: [] };
  const { max, bare, section } = bookHabits(structure);
  const poetry = [1, 2, 3, 4].filter((level) => level <= max).map((level) => spell(level, bare));
  const lines = ["m", "p", ...poetry];
  // A heading lists itself, so the menu marks what it is now.
  if (HEADINGS.has(b.kind)) return { kind: b.kind, choices: [...lines, b.kind] };
  const words = state.doc.sliceString(b.contentFrom, b.to);
  return { kind: b.kind, choices: HAS_VERSE.test(words) ? lines : [...lines, section] };
}

/** Turns the line at an offset into another kind, as one Undo step; null when it cannot. */
export function turnLineInto(
  state: EditorState,
  offset: number,
  kind: string,
): TransactionSpec | null {
  const line = lineKindAt(state, offset);
  if (line === null || !line.choices.includes(kind) || line.kind === kind) return null;
  const structure = structureAt(state);
  const b = blockAt(structure, offset);
  if (b === null) return null;
  // Only the verse at the offset changes kind; a heading is only offered on a
  // line with no verse, so it takes the whole line.
  return {
    changes: restyle(state, structure, b, offset, kind),
    annotations: trusted.of("poetry-level"),
    userEvent: "input.usfm.reparent",
  };
}
