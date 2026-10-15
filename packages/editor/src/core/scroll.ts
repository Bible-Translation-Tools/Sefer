/**
 * Doing something to the book without moving the page.
 *
 * Undo and redo are the BOOK's, whichever surface asked for them — the
 * toolbar's buttons, the palette, `Mod-z` inside an open note editor — so they
 * all run against the canonical view. CodeMirror's history restores the
 * selection THAT view held before the change and asks to scroll to it, which
 * is right when the reader is in it and wrong when they are not: pressing
 * Undo while typing in a footnote threw the page from the apparatus at the
 * foot of the chapter back up to the verse, took the open row out of the
 * viewport, and destroyed the note editor along with the widget holding it.
 *
 * So the scroll — and only the scroll — is refused for the length of that one
 * gesture. `EditorView.scrollHandler` is CodeMirror's own hook for this, and
 * returning true from it means "handled": the transaction lands, the selection
 * moves, every surface hears the change back through its `Funnel`, and the
 * page stays where the reader left it.
 *
 * The flag is a COUNT and it is released a frame later, not at the end of the
 * call: CodeMirror performs a scroll target in its measure pass, which runs
 * after the dispatch returns.
 */

import { EditorView } from "@codemirror/view";

let quiet = 0;

/** Runs `gesture` with this application's scroll-into-view requests refused. */
export const withoutScrolling = <T>(gesture: () => T): T => {
  quiet += 1;
  try {
    return gesture();
  } finally {
    if (typeof requestAnimationFrame === "function")
      requestAnimationFrame(() => {
        quiet -= 1;
      });
    else quiet -= 1;
  }
};

/** The facet value; installed once, in `viewLayer`. */
export const scrollGuard = EditorView.scrollHandler.of(() => quiet > 0);
