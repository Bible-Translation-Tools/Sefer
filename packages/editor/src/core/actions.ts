import type { EditorState, StateCommand, TransactionSpec } from "@codemirror/state";

import { structureAt } from "./editorState";
import { focusFrontMatter } from "./frontmatter";
import {
  insertFootnote,
  insertParagraph,
  insertPoetry,
  insertVerse,
  type EditorAction,
} from "./insert";
import { deleteColumn, deleteRow, insertColumn, insertRow } from "./tableCommands";

export type { EditorAction } from "./insert";

/** A table command at the caret: false (nothing done) where the caret is in no table. */
const atCaret =
  (command: (state: EditorState, pos: number) => TransactionSpec | null): StateCommand =>
  ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const spec = command(state, state.selection.main.head);
    if (spec === null) return false;
    dispatch(state.update(spec));
    return true;
  };

const editFrontMatter: StateCommand = ({ state, dispatch }) => {
  dispatch(state.update({ effects: focusFrontMatter.of(null) }));
  return true;
};

const COMMANDS: Record<EditorAction, () => StateCommand> = {
  "insert.verse": () => insertVerse(structureAt),
  "insert.paragraph": () => insertParagraph(structureAt),
  "insert.poetry": () => insertPoetry(structureAt),
  "insert.poetry1": () => insertPoetry(structureAt, 1),
  "insert.poetry2": () => insertPoetry(structureAt, 2),
  "insert.footnote": () => insertFootnote(),
  "frontmatter.edit": () => editFrontMatter,
  "table.rowAbove": () => atCaret((state, pos) => insertRow(state, pos, "above")),
  "table.rowBelow": () => atCaret((state, pos) => insertRow(state, pos, "below")),
  "table.deleteRow": () => atCaret(deleteRow),
  "table.columnBefore": () => atCaret((state, pos) => insertColumn(state, pos, "before")),
  "table.columnAfter": () => atCaret((state, pos) => insertColumn(state, pos, "after")),
  "table.deleteColumn": () => atCaret(deleteColumn),
};

export const actionCommand = (action: EditorAction): StateCommand => COMMANDS[action]();
