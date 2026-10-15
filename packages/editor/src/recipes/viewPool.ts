import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Retired read-only views, kept to be handed the next card's state — shared
 * by the reader (`reader.ts`) and the diff card (`diffView.ts`).
 *
 * A windowed list mounts a card and unmounts another on nearly every frame it
 * scrolls, and constructing an `EditorView` was most of a card's cost: the
 * constructor reads `document.fonts.ready`, which forces a style recalculation
 * of the whole page (~3.5 ms a card on en_ulb Psalms), and it sets
 * `contenteditable` on a connected element, which Chrome answers with editing-
 * state work of its own. A view given a new state with `setState` pays
 * neither. Every reader has the same shape — read-only, no plugins that hold
 * anything outside their state — so any retired view can take any card.
 *
 * Bounded: a list shows twenty or so cards, and more than that retired at
 * once is a list that went away, not one that is scrolling.
 */
const POOL_LIMIT = 32;

const pool: EditorView[] = [];

export const takeView = (state: EditorState): EditorView => {
  const held = pool.pop();
  if (held === undefined) return new EditorView({ state });
  held.setState(state);
  return held;
};

export const giveBack = (view: EditorView): void => {
  view.dom.remove();
  if (pool.length < POOL_LIMIT) pool.push(view);
  else view.destroy();
};
