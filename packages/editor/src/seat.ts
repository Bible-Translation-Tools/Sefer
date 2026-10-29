import type { Extension } from "@codemirror/state";
import type { Book } from "@sefer/text/book";

import { editorBook, type EditorBook, type EditorBookOptions } from "./book";
import { viewLayer } from "./core/compose";
import { commandsLayer } from "./core/keymaps";
import { findingMarks } from "./recipes/findingMarks";
import { usfmLinter } from "./recipes/lint";
import { lintHoverGrace } from "./recipes/lintHover";
import { noteEditing } from "./recipes/noteEditor";

let mountable: Extension | undefined;

const canonicalEditor = (): Extension =>
  (mountable ??= [
    commandsLayer,
    viewLayer(),
    usfmLinter(),
    lintHoverGrace(),
    findingMarks(),
    noteEditing(),
  ]);

/** The editor-backed Book over `plain`, with the canonical editor's whole feature set. */
export const seatBook = (plain: Book, options: Omit<EditorBookOptions, "extensions">): EditorBook =>
  editorBook(plain, { ...options, extensions: canonicalEditor() });
