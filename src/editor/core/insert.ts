/**
 * The four structured insertions: a verse, a paragraph, a poetry line, a
 * footnote.
 *
 * Each one is a `StateCommand` that reads the CURRENT selection out of the
 * state it was handed, builds ONE `TransactionSpec`, and dispatches it. It
 * does not reach past the kernel: the phases judge the result exactly as they
 * judge a keystroke — admission may veto it, `keepPoetryMarkersAtTheStartOfTheirLine`
 * may straighten it, settlement moves the caret onto a legal stop — and
 * because it is one transaction it is one Undo step.
 *
 * None of them is `trusted`. That is the whole point of routing them here
 * rather than through `book.apply(…, trustedBy(…))`: a structured insertion is
 * a gesture a person made at a caret, so it should meet the same doors a typed
 * character meets. (The one structured surface that IS trusted is the front
 * matter card — see `frontmatter.ts` — because it writes outside any chapter
 * clip and must not be refused for that.)
 *
 * `userEvent` is `input.usfm.<what>`. CodeMirror's `isUserEvent` matches by
 * prefix, so these read as `input` (the delimiter rule still applies) but not
 * as `input.type` (the typed-backslash rule does not — a marker inserted on
 * purpose is not a typed backslash).
 */

import type { StateCommand } from "@codemirror/state";
import { EditorState } from "@codemirror/state";

import { chapterContaining } from "./clip";
import { opensAParagraph, type DocStructure } from "./docStructure";
import { blockAt, nl, type GetStructure } from "./kernel";
import { note } from "./trace";

/**
 * The named gestures the shell may ask a book to perform. Strings rather than
 * `StateCommand`s because this crosses `src/editor`'s front door, and nothing
 * above it imports CodeMirror.
 */
export type EditorAction =
  | "insert.verse"
  | "insert.paragraph"
  | "insert.poetry"
  | "insert.poetry1"
  | "insert.poetry2"
  | "insert.footnote"
  | "frontmatter.edit";

/** A letter, a digit, or the punctuation that lives inside a word. */
const WORD = /[\p{L}\p{N}'’‐-]/u;

const isWordChar = (state: EditorState, at: number): boolean =>
  at >= 0 && at < state.doc.length && WORD.test(state.doc.sliceString(at, at + 1));

/**
 * Where an insertion may land when the caret sits inside a word.
 *
 * Two kinds of "inside a word" here, and both move the same way — forward, to
 * the far edge — because a marker inserted in the middle of a word splits the
 * word, and no gesture means that. An aligned `\w …\w*` wrapper is checked
 * first: its interior is one indivisible thing, and its `to` is past the
 * closer, not past the surface.
 */
function wordBoundaryAt(state: EditorState, s: DocStructure, pos: number): number {
  const line = s.lines.maybe(state.doc.lineAt(pos).number - 1);
  const wrapper = line?.words.find((w) => pos > w.from && pos < w.to);
  if (wrapper) return wrapper.to;
  if (!isWordChar(state, pos - 1) || !isWordChar(state, pos)) return pos;
  const end = state.doc.lineAt(pos).to;
  let at = pos;
  while (at < end && isWordChar(state, at)) at++;
  return at;
}

/**
 * The number the next `\v` should carry: the highest verse number already
 * opened in this chapter at or before `pos`, plus one.
 *
 * Read off the structure rather than counted, so a book that starts at verse 5
 * or numbers a range `\v 1-2` still answers sensibly — the trailing digit run
 * is what a range's "last verse" is. A chapter with no verse yet answers 1.
 */
function nextVerseNumber(s: DocStructure, pos: number): string {
  const chapter = chapterContaining(s.chapters, pos);
  const floor = chapter === null ? 0 : chapter.from;
  let last = 0;
  for (const v of s.verses) {
    if (v.markerFrom > pos) break;
    if (v.markerFrom < floor || v.num === null) continue;
    const digits = /(\d+)\D*$/.exec(v.num);
    if (digits) last = Math.max(last, Number(digits[1]));
  }
  return String(last + 1);
}

/**
 * `\v N ` at the caret, with `N` SELECTED so the first keystroke replaces it.
 *
 * A leading space is supplied when the caret is hard against a glyph: the
 * number is the address of everything after it, and `word\v 5 ` would leave
 * the address welded to the previous word in the source.
 */
export function insertVerse(structureAt: GetStructure): StateCommand {
  return ({ state, dispatch }) => {
    const s = structureAt(state);
    const sel = state.selection.main;
    const at = sel.empty ? wordBoundaryAt(state, s, sel.from) : sel.to;
    const num = nextVerseNumber(s, at);
    const pad = at > 0 && !/\s/.test(state.doc.sliceString(at - 1, at)) ? " " : "";
    const insert = `${pad}\\v ${num} `;
    const numFrom = at + pad.length + 3;
    note(state, {
      rule: "insertVerse",
      verdict: "rewrote",
      detail: `\\v ${num} at ${at}${at === sel.from ? "" : ` (from ${sel.from}, past a word)`}`,
    });
    dispatch(
      state.update({
        changes: { from: at, insert },
        selection: { anchor: numFrom, head: numFrom + num.length },
        userEvent: "input.usfm.verse",
        scrollIntoView: true,
      }),
    );
    return true;
  };
}

/**
 * A block marker at the caret: split the line and open a new block, or — when
 * the caret is already at the head of this block's content — convert the block
 * it is in.
 *
 * `pick` is given the current block's marker so poetry can decide its own
 * level by repetition (`\q1` pressed again is `\q2`); a caller that knows the
 * level passes a constant.
 */
function insertBlock(
  structureAt: GetStructure,
  event: string,
  pick: (current: string | null) => string,
): StateCommand {
  return ({ state, dispatch }) => {
    const s = structureAt(state);
    const sel = state.selection.main;
    const block = blockAt(s, sel.from);
    const marker = pick(block === null ? null : block.kind);
    const nlch = nl(state);

    if (block !== null && sel.empty && sel.from === block.contentFrom) {
      const head = block.lines[0];
      // The same two shapes `setBlockMarker` uses: a block that already opens
      // with a marker has that marker replaced, and one that does not (the
      // first line of a chapter, say) gets a marker line above it.
      const changes = opensAParagraph(head)
        ? { from: head.from, to: head.contentFrom, insert: `\\${marker} ` }
        : { from: head.from, to: head.from, insert: `\\${marker}${nlch}` };
      note(state, {
        rule: "insertBlock",
        verdict: "rewrote",
        detail: `converted ${block.kind} → ${marker} at ${head.from}`,
      });
      dispatch(state.update({ changes, userEvent: "input.usfm.reparent", scrollIntoView: true }));
      return true;
    }

    const insert = `${nlch}\\${marker} `;
    note(state, {
      rule: "insertBlock",
      verdict: "rewrote",
      detail: `split at ${sel.from} and opened \\${marker}`,
    });
    dispatch(
      state.update({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: sel.from + insert.length },
        userEvent: `input.usfm.${event}`,
        scrollIntoView: true,
      }),
    );
    return true;
  };
}

const POETRY_LEVELS = ["q1", "q2"];

/** `\q1`, or the next level when the caret is already in one (the repeat). */
const nextPoetryLevel = (current: string | null): string => {
  const at = current === null ? -1 : POETRY_LEVELS.indexOf(current === "q" ? "q1" : current);
  return POETRY_LEVELS[(at + 1) % POETRY_LEVELS.length] ?? "q1";
};

export const insertParagraph = (structureAt: GetStructure): StateCommand =>
  insertBlock(structureAt, "paragraph", () => "p");

export const insertPoetry = (structureAt: GetStructure, level?: 1 | 2): StateCommand =>
  insertBlock(structureAt, "poetry", (current) =>
    level === undefined ? nextPoetryLevel(current) : `q${level}`,
  );

/** What a fresh footnote is made of, spelled once. */
const NOTE_OPEN = "\\f + \\ft ";
const NOTE_CLOSE = "\\f*";

/**
 * Text a note may take as its body: one line, no markup.
 *
 * A selection in regular mode is measured in SOURCE offsets, and the source
 * between two visible glyphs may be a paragraph break and a `\s5` the reader
 * never saw — Shift-Right at the end of a line crosses all of it in one press.
 * Moving that into a note body produces `\f + \ft …\p …\f*`, which is neither
 * what anybody asked for nor valid. So a run that crosses a line or carries a
 * marker is not wrapped: the note is anchored at the selection's start and the
 * text is left exactly where it is. Refusing to guess is the same answer
 * Search gives to a hit that straddles markup.
 */
const wrappable = (body: string): boolean => !body.includes("\n") && !body.includes("\\");

/**
 * `\f + \ft …\f*` around the selection, or empty at the caret, with the caret
 * left at the end of the `\ft` content.
 *
 * Where the caret ENDS UP is settlement's call, not this command's. In regular
 * mode `note.markup` and `note.body` are elided, so the note collapses to its
 * caller the instant it parses and the caret is pushed out to the nearest
 * legal stop beside it; in USFM mode the caret stays inside the `\ft`. Both
 * are correct, and neither is special-cased here — the projection decides what
 * a note looks like, and the caret rules follow the projection.
 */
export function insertFootnote(): StateCommand {
  return ({ state, dispatch }) => {
    const sel = state.selection.main;
    const selected = state.doc.sliceString(sel.from, sel.to);
    const wraps = wrappable(selected);
    const body = wraps ? selected : "";
    const to = wraps ? sel.to : sel.from;
    const insert = `${NOTE_OPEN}${body}${NOTE_CLOSE}`;
    const caret = sel.from + NOTE_OPEN.length + body.length;
    note(state, {
      rule: "insertFootnote",
      verdict: "rewrote",
      detail: wraps
        ? `note over [${sel.from},${sel.to}) — ${body.length} char(s) of body`
        : `empty note at ${sel.from} — the selection crosses markup, so it is not wrapped`,
    });
    dispatch(
      state.update({
        changes: { from: sel.from, to, insert },
        selection: { anchor: caret },
        userEvent: "input.usfm.footnote",
        scrollIntoView: true,
      }),
    );
    return true;
  };
}
