/**
 * Seating a book: a plain Book becomes the editor-backed one, carrying
 * everything the canonical editor draws and answers — the commands, the view
 * layer, the inline linter with its hover and gutter, and footnotes that can be
 * typed in.
 *
 * The feature set is the package's, not the host's: a host passes its engine
 * and its tracing and gets the whole editor (planning item "embeddable
 * editor"). Built once and shared by every seated book, as it always was.
 */

import { lintGutter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { Book } from "@sefer/text/book";

import { editorBook, type EditorBook, type EditorBookOptions } from "./book";
import { commandsLayer, viewLayer } from "./core/compose";
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
    lintGutter(),
    // Footnote callers that follow and note bodies that can be typed in.
    noteEditing(),
  ]);

/** The editor-backed Book over `plain`, with the canonical editor's whole feature set. */
export const seatBook = (plain: Book, options: Omit<EditorBookOptions, "extensions">): EditorBook =>
  editorBook(plain, { ...options, extensions: canonicalEditor() });
