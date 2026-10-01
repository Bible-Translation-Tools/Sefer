/**
 * The behaviour matrix every card surface starts from — Find, Findings, Key
 * terms, Review — so a card is one kind of editor wherever it is.
 *
 * In Regular, verse numbers are pips no key can take (`lock-verse-numbers`):
 * a card's place is its verse, and a card whose verse was deleted or
 * renumbered under it is "No longer an occurrence". A screen adds its own
 * presets on top (Key terms hides notes). USFM is the whole markup, verse
 * numbers included, for a reader who flipped a card to edit exactly that.
 */

import { editorPolicy, type EditorPolicy, type ProjectionName } from "#editor/index";

export const cardPolicy = (
  mode: "regular" | "usfm",
  ...regular: readonly ProjectionName[]
): EditorPolicy =>
  mode === "usfm"
    ? editorPolicy("usfm")
    : editorPolicy("regular", "lock-verse-numbers", ...regular);
