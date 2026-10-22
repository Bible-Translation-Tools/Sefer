import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";

import { docText, structureAt } from "./docStructure";
import { isVisual, trusted } from "./kernel";
import { assignmentAt } from "./registry";

/**
 * A table's edits, as a table menu offers them: a row above or below, a row
 * deleted, a column inserted or deleted (in every row, so the table keeps its
 * shape), and the keys that walk its cells. Plain transaction specs, as the
 * verse commands are (`verseCommands.ts`): a host runs them with no menu.
 * Trusted, as every edit the editor builds itself is: a cell's marker is
 * immortal to a keystroke.
 */
const TABLE_EDIT = { annotations: trusted.of("table"), scrollIntoView: true } as const;

interface Cell {
  /** `th`, `tc`. */
  readonly kind: string;
  /** `""`, `r` or `c`: start, end or centre. */
  readonly align: string;
  /** The cell marker's span, and its words' span after it (to the next cell or the line's end). */
  readonly markerFrom: number;
  readonly markerTo: number;
  readonly contentTo: number;
  readonly text: string;
}

interface Row {
  readonly from: number;
  readonly to: number;
  readonly cells: readonly Cell[];
}

const SPELLED = /^\\t([hc])([rc]?)\d*/;

/** The table row on the line holding `pos`, or `null` when it is not a row. */
function rowAt(state: EditorState, pos: number): Row | null {
  const structure = structureAt(state);
  const doc = docText(state);
  const line = state.doc.lineAt(pos);
  const docLine = structure.lines.maybe(line.number - 1);
  if (docLine === null || docLine.cls !== "table" || docLine.cells.length === 0) return null;
  const cells = docLine.cells.map((cell, at) => {
    const contentTo = docLine.cells[at + 1]?.from ?? line.to;
    const spelled = SPELLED.exec(doc.slice(cell.from, cell.to));
    return {
      kind: `t${spelled?.[1] ?? "c"}`,
      align: spelled?.[2] ?? "",
      markerFrom: cell.from,
      markerTo: cell.to,
      contentTo,
      text: doc.slice(cell.to, contentTo).trim(),
    };
  });
  return { from: line.from, to: line.to, cells };
}

/** The rows of the table holding `pos`: the run of row lines around it. */
function tableAt(state: EditorState, pos: number): Row[] {
  const here = rowAt(state, pos);
  if (here === null) return [];
  const rows = [here];
  for (let at = here.from - 1; at > 0;) {
    const row = rowAt(state, at);
    if (row === null) break;
    rows.unshift(row);
    at = row.from - 1;
  }
  for (let at = here.to + 1; at <= state.doc.length;) {
    const row = rowAt(state, at);
    if (row === null) break;
    rows.push(row);
    at = row.to + 1;
  }
  return rows;
}

/** The cell of `row` whose words hold `pos`: the last whose marker ends at or before it. */
const cellIndex = (row: Row, pos: number): number => {
  let found = 0;
  row.cells.forEach((cell, at) => {
    if (cell.markerTo <= pos) found = at;
  });
  return found;
};

/** A row as written: `\tr \th1 Tribe \thr2 Number`, its cells numbered in order. */
const writeRow = (cells: readonly Pick<Cell, "kind" | "align" | "text">[]): string =>
  `\\tr ${cells.map((c, at) => `\\${c.kind}${c.align}${at + 1} ${c.text}`.trimEnd()).join(" ")}`;

const rowChange = (row: Row, cells: readonly Pick<Cell, "kind" | "align" | "text">[]) => ({
  from: row.from,
  to: row.to,
  insert: writeRow(cells),
});

/** A new row's empty cells, shaped as `row`'s, a header row's as body cells. */
const emptyLike = (row: Row) => row.cells.map((c) => ({ kind: "tc", align: c.align, text: "" }));

export function insertRow(
  state: EditorState,
  pos: number,
  where: "above" | "below",
): TransactionSpec | null {
  const row = rowAt(state, pos);
  if (row === null) return null;
  const written = writeRow(emptyLike(row));
  const at = where === "above" ? row.from : row.to;
  const insert = where === "above" ? `${written}\n` : `\n${written}`;
  const first = where === "above" ? at : at + 1;
  return {
    changes: { from: at, insert },
    selection: EditorSelection.cursor(first + written.indexOf(" ", 4) + 1),
    ...TABLE_EDIT,
  };
}

export function deleteRow(state: EditorState, pos: number): TransactionSpec | null {
  const row = rowAt(state, pos);
  if (row === null) return null;
  const from = row.from > 0 ? row.from - 1 : row.from;
  const to = row.from > 0 ? row.to : Math.min(row.to + 1, state.doc.length);
  return { changes: { from, to }, ...TABLE_EDIT };
}

export function insertColumn(
  state: EditorState,
  pos: number,
  side: "before" | "after",
): TransactionSpec | null {
  const here = rowAt(state, pos);
  if (here === null) return null;
  const k = cellIndex(here, pos) + (side === "after" ? 1 : 0);
  const changes = tableAt(state, pos).map((row) => {
    const cells: Pick<Cell, "kind" | "align" | "text">[] = [...row.cells];
    cells.splice(k, 0, { kind: row.cells[0]?.kind === "th" ? "th" : "tc", align: "", text: "" });
    return rowChange(row, cells);
  });
  return { changes, ...TABLE_EDIT };
}

export function deleteColumn(state: EditorState, pos: number): TransactionSpec | null {
  const here = rowAt(state, pos);
  if (here === null || here.cells.length < 2) return null;
  const k = cellIndex(here, pos);
  const changes = tableAt(state, pos).map((row) =>
    rowChange(
      row,
      row.cells.filter((_, at) => at !== k),
    ),
  );
  return { changes, ...TABLE_EDIT };
}

/** Where the caret goes in a cell: just after its marker, at its words. */
const cellStart = (cell: Cell): number => cell.markerTo;

/** Tab and Shift-Tab walk a table's cells, in Reading only: line by line keeps its own Tab. */
function walkCells(view: EditorView, step: 1 | -1): boolean {
  const state = view.state;
  if (!isVisual(state) || assignmentAt(state).verseLines) return false;
  const head = state.selection.main.head;
  const rows = tableAt(state, head);
  const r = rows.findIndex((row) => head >= row.from && head <= row.to);
  if (r < 0) return false;
  const row = rows[r];
  const c = cellIndex(row, head);
  const next = row.cells[c + step];
  let target: number | null = next === undefined ? null : cellStart(next);
  if (target === null) {
    const other = rows[r + step];
    const cell = other?.cells[step === 1 ? 0 : other.cells.length - 1];
    target = cell === undefined ? null : cellStart(cell);
  }
  if (target === null) {
    if (step === -1) return true;
    const spec = insertRow(state, head, "below");
    if (spec !== null) view.dispatch(spec);
    return true;
  }
  view.dispatch({
    selection: EditorSelection.cursor(target),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

/** Backspace or Delete in a row whose every cell is empty takes the row, as an empty paragraph goes. */
function takeEmptyRow(view: EditorView): boolean {
  const state = view.state;
  if (!isVisual(state) || !state.selection.main.empty) return false;
  const row = rowAt(state, state.selection.main.head);
  if (row === null || row.cells.some((cell) => cell.text !== "")) return false;
  const spec = deleteRow(state, row.from);
  if (spec === null) return false;
  view.dispatch(spec);
  return true;
}

export const tableKeys = (): readonly KeyBinding[] => [
  { key: "Tab", run: (view) => walkCells(view, 1) },
  { key: "Shift-Tab", run: (view) => walkCells(view, -1) },
  { key: "Backspace", run: takeEmptyRow },
  { key: "Delete", run: takeEmptyRow },
];
