/**
 * Which chapter is at the top of the viewport, and a way to be told when that
 * changes.
 *
 * The shell's location bar asks this on every scroll. It is a recipe and not a
 * state field on purpose: the answer is a fact about the VIEWPORT, not about
 * the document, so two views over the same book can honestly disagree and
 * nothing in the canonical state should carry it.
 */

import type { EditorView } from "@codemirror/view";

import { chapterContaining } from "../core/clip";
import { structureAt } from "../core/docStructure";

export interface Where {
  /** The index into the engine's chapter table — row 0 is the front matter. */
  readonly ordinal: number;
  /** `\c`'s own number, as written. Empty for the front matter. */
  readonly label: string;
}

/**
 * The chapter containing the first line the reader can see.
 *
 * Measured from the scroller's own top edge rather than from `visibleRanges`,
 * which CodeMirror widens well past what is on screen.
 */
export function chapterAtTop(view: EditorView): Where | null {
  const structure = structureAt(view.state);
  if (structure.chapters.length === 0) return null;
  const box = view.scrollDOM.getBoundingClientRect();
  // One pixel in, and half a line down, so the reading is the line the reader
  // sees rather than whatever is clipped at the seam.
  const at = view.posAtCoords({ x: box.left + 8, y: box.top + 2 }, false);
  const found = chapterContaining(structure.chapters, Math.max(0, at));
  if (found === null) return { ordinal: 0, label: structure.chapters[0]?.label ?? "" };
  return { ordinal: found.ordinal, label: found.label };
}

/** Every chapter of this view's book, front matter row included. */
export function chapterList(view: EditorView): readonly Where[] {
  return structureAt(view.state).chapters.map((chapter) => ({
    ordinal: chapter.ordinal,
    label: chapter.label,
  }));
}

/**
 * Calls `report` whenever the chapter at the top may have changed: on scroll,
 * and on the layout changes that move the text under a still pointer.
 *
 * Returns the detach. The scroll listener is passive and coalesced into one
 * animation frame, because a scroll fires per pixel and this is a string in a
 * bar.
 */
export function watchLocation(view: EditorView, report: (where: Where | null) => void): () => void {
  let queued = false;
  const read = (): void => {
    queued = false;
    report(chapterAtTop(view));
  };
  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(read);
  };
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
  read();
  return () => {
    view.scrollDOM.removeEventListener("scroll", onScroll);
  };
}
