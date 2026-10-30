import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";

import { blockAt, isVisual, nl, trusted } from "../kernel";
import { structureAt, type Block, type DocStructure } from "../model/docStructure";
import { assignmentAt } from "../model/registry";

/**
 * Poetry levels in Refine, the way Word indents a list: Tab moves the line one
 * level in (`\p` → `\q1` → `\q2`), Shift-Tab one level out, and Enter on an
 * empty poetry line, or Backspace at a poetry line's start, steps out one
 * level (`\q2` → `\q1` → `\p`). No tab character is ever written.
 *
 * Tab moves only the verse the caret is in (Thomas, 2026-10-30): a line of
 * several verses is split around it, the verse on a line of its own at the
 * new level and the verses after it on a new line of the old kind. A
 * selection over several lines moves each line it touches, whole. Level 3 and 4 exist only
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
}

const habitsSeen = new WeakMap<DocStructure, Habits>();

const bookHabits = (structure: DocStructure): Habits => {
  const seen = habitsSeen.get(structure);
  if (seen !== undefined) return seen;
  let deepest = 0;
  let bare = false;
  const blocks = structure.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const kind = blocks.at(i).kind;
    if (kind === "q") bare = true;
    deepest = Math.max(deepest, levelOf(kind) ?? 0);
  }
  const habits = { max: Math.max(BASE_MAX, deepest), bare };
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

const shift =
  (step: 1 | -1): StateCommand =>
  ({ state, dispatch }) => {
    if (!inRefine(state)) return false;
    const structure = structureAt(state);
    const touched = touchedBlocks(state, structure);
    const only = touched.length === 1 ? touched[0] : undefined;
    if (only !== undefined && state.selection.ranges.length === 1) {
      const level = levelOf(only.kind);
      if (level !== null && only.lines[0]?.marker != null) {
        const { max, bare } = bookHabits(structure);
        const next = Math.min(max, Math.max(0, level + step));
        if (next === level) return true;
        const split = splitAroundVerse(state, only, state.selection.main.head, spell(next, bare));
        if (split !== null) {
          const changes = state.changes(split);
          dispatch(
            state.update({
              changes,
              selection: EditorSelection.cursor(changes.mapPos(state.selection.main.head, 1)),
              annotations: trusted.of("poetry-level"),
              userEvent: "input.usfm.reparent",
              scrollIntoView: true,
            }),
          );
          return true;
        }
      }
    }
    const changes = [];
    for (const b of touched) {
      const level = levelOf(b.kind);
      const head = b.lines[0];
      if (level === null || head === undefined || head.marker === null) continue;
      const { max, bare } = bookHabits(structure);
      const next = Math.min(max, Math.max(0, level + step));
      if (next === level) continue;
      changes.push(remark(b, spell(next, bare)));
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

/**
 * The changes that put the verse holding `at` on a line of its own as `kind`,
 * the verses after it on a new line of the block's old kind; null when the
 * block holds one verse or fewer (then the marker alone is rewritten).
 */
function splitAroundVerse(
  state: EditorState,
  b: Block,
  at: number,
  kind: string,
): ChangeSpec[] | null {
  const text = state.doc.sliceString(b.contentFrom, b.to);
  const starts = [b.contentFrom];
  for (const match of text.matchAll(/\\v[ \t]/g)) {
    const pos = b.contentFrom + match.index;
    // A verse on the line after its marker (`\q` / `\v 2`) still opens the line.
    const opens = state.doc.sliceString(b.contentFrom, pos).trim() === "";
    if (pos > b.contentFrom && !opens) starts.push(pos);
  }
  if (starts.length < 2) return null;
  const i = starts.findLastIndex((start) => start <= at);
  const from = starts[i] ?? b.contentFrom;
  const to = starts[i + 1];
  // A break replaces the spaces or line break before it: `a \v 2` → `a` / `\q1 \v 2`.
  const breakAt = (pos: number, marker: string): ChangeSpec => {
    let start = pos;
    while (start > b.contentFrom && /\s/.test(state.doc.sliceString(start - 1, start))) start--;
    return { from: start, to: pos, insert: `${nl(state)}\\${marker} ` };
  };
  const changes: ChangeSpec[] = [i === 0 ? remark(b, kind) : breakAt(from, kind)];
  if (to !== undefined) changes.push(breakAt(to, b.kind));
  return changes;
}

/** Before a line's first word: nothing, or only the verse number that opens it. */
const NO_WORDS_YET = /^\s*(\\v([ \t]+[\w-]*)?[ \t]*)?$/;

/** Enter on an empty poetry line (a verse number alone still counts as empty) steps out one level: `\q2` → `\q1` → `\p`. */
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
      changes: remark(b, spell(level - 1, bookHabits(structure).bare)),
      annotations: trusted.of("poetry-level"),
      userEvent: "input.usfm.reparent",
      scrollIntoView: true,
    }),
  );
  return true;
};

/**
 * Backspace at the very start of a poetry line steps out one level, as Word
 * takes a bullet off before it joins lines: `\q2` → `\q1` → `\p`, and only then does
 * Backspace join the line above. "The start" is anywhere before the
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
  const before = state.doc.sliceString(b.contentFrom, sel.from);
  if (!NO_WORDS_YET.test(before)) return false;
  dispatch(
    state.update({
      changes: remark(b, spell(level - 1, bookHabits(structure).bare)),
      annotations: trusted.of("poetry-level"),
      userEvent: "input.usfm.reparent",
      scrollIntoView: true,
    }),
  );
  return true;
};

/** The commands, by id; their keys are `keymaps.ts`'s. */
export const poetryLevelCommands = {
  "poetry.leaveAtLineStart": stepOutAtLineStart,
  "poetry.indent": shift(1),
  "poetry.outdent": shift(-1),
  "poetry.leaveEmptyLine": stepOutOfEmptyPoetry,
};

/**
 * The kinds a line can be from its menu: a paragraph flush (`\m`) or indented
 * (`\p`), and the poetry levels the book allows; no list items (Will,
 * 2026-10-29). Lines of the wider family (`\pi`, `\li`) can be turned into
 * them. Each is one marker name for another, so the line's words never move.
 */
const TURNABLE = new Set(["p", "m", "pi", "q", "q1", "q2", "q3", "q4", "li", "li1"]);

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
  if (!TURNABLE.has(b.kind)) return { kind: b.kind, choices: [] };
  const { max, bare } = bookHabits(structure);
  const poetry = [1, 2, 3, 4].filter((level) => level <= max).map((level) => spell(level, bare));
  return { kind: b.kind, choices: ["m", "p", ...poetry] };
}

/** Turns the line at an offset into another kind, as one Undo step; null when it cannot. */
export function turnLineInto(
  state: EditorState,
  offset: number,
  kind: string,
): TransactionSpec | null {
  const line = lineKindAt(state, offset);
  if (line === null || !line.choices.includes(kind) || line.kind === kind) return null;
  const b = blockAt(structureAt(state), offset);
  if (b === null) return null;
  return {
    changes: remark(b, kind),
    annotations: trusted.of("poetry-level"),
    userEvent: "input.usfm.reparent",
  };
}
