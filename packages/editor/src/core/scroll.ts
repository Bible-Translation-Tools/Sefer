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
