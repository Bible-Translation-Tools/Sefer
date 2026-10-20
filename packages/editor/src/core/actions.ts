import type { StateCommand } from "@codemirror/state";

import { structureAt } from "./editorState";
import { focusFrontMatter } from "./frontmatter";
import {
  insertFootnote,
  insertParagraph,
  insertPoetry,
  insertVerse,
  type EditorAction,
} from "./insert";

export type { EditorAction } from "./insert";

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
};

export const actionCommand = (action: EditorAction): StateCommand => COMMANDS[action]();
