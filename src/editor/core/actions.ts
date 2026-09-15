/**
 * The named editor gestures, as one lookup.
 *
 * The shell has a `Book`, not an `EditorView` — nothing above `src/editor`
 * imports CodeMirror — so a command in `src/app/commands.ts` asks for a gesture
 * BY NAME and `EditorBook.perform` runs it against whichever seat is canonical
 * (the bound view when there is one, the held state when there is not). That is
 * the same door `undo`/`redo` already go through, which is why an insertion is
 * one Undo step whether it came from the palette, a key, or a toolbar button.
 */

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

/**
 * Focusing the card is not a document change, so it dispatches an effect and
 * reports true; a state with no card (headless, USFM mode) simply drops it.
 */
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

// SAFETY: COMMANDS is `Record<EditorAction, …>` written as a literal with
// every member of the union spelled out, so its own keys are exactly
// `EditorAction`; `Object.keys` only widens them to string.
export const EDITOR_ACTIONS = Object.keys(COMMANDS) as readonly EditorAction[];

export const actionCommand = (action: EditorAction): StateCommand => COMMANDS[action]();
