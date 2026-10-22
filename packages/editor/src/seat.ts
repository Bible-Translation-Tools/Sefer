import type { Extension } from "@codemirror/state";
import type { Book } from "@sefer/text/book";

import { editorBook, type EditorBook, type EditorBookOptions } from "./book";
import { commandsLayer, viewLayer } from "./core/compose";
import { usfmLinter } from "./recipes/lint";
import { lintGutter } from "./recipes/lintGutter";
import { lintHoverGrace } from "./recipes/lintHover";
import { noteEditing } from "./recipes/noteEditor";

let mountable: Extension | undefined;

const canonicalEditor = (): Extension =>
  (mountable ??= [
    commandsLayer,
    viewLayer(),
    usfmLinter(),
    lintHoverGrace(),
    lintGutter(),
    noteEditing(),
  ]);

/** The editor-backed Book over `plain`, with the canonical editor's whole feature set. */
export const seatBook = (plain: Book, options: Omit<EditorBookOptions, "extensions">): EditorBook =>
  editorBook(plain, { ...options, extensions: canonicalEditor() });
