/**
 * Which chapter the reader is looking at, and a way to be told when that
 * changes.
 *
 * The shell's location bar asks this on every scroll. It is a recipe and not a
 * state field on purpose: the answer is a fact about the VIEWPORT, not about
 * the document, so two views over the same book can honestly disagree and
 * nothing in the canonical state should carry it.
 */

import type { EditorView } from "@codemirror/view";

import { structureAt } from "../core/docStructure";

export interface Where {
  /** The index into the engine's chapter table — row 0 is the front matter. */
  readonly ordinal: number;
  /** `\c`'s own number, as written. Empty for the front matter. */
  readonly label: string;
}

/**
 * Which chapter the reader is in.
 *
 * It used to be the chapter under the scroller's TOP EDGE, and that reading is
 * twitchy in exactly the place it is read most. Scroll a chapter heading two
 * lines past the top and a few lines of the previous chapter are still
 * showing: the top edge is in chapter 3, the reader is plainly in chapter 4,
 * and every reference pane snaps back a chapter (Will, 2026-09-18 — "the left
 * editor snaps to three cause a tiny piece of verse 3 is showing").
 *
 * Two rules, and the first is the one a reader would state:
 *
 *  1. **A `\c` in the top half of the viewport wins** — the LAST one, so a
 *     chapter you have already scrolled past does not hold the crumb. Arriving
 *     at a heading is the least ambiguous thing that happens while scrolling,
 *     and it should say so the moment it lands rather than waiting for the
 *     chapter to outgrow its neighbours.
 *  2. **Otherwise, whichever chapter fills most of the viewport.** Deep inside
 *     a long chapter there is no heading to go on, and "most of what I can
 *     see" needs no threshold — it answers itself at every scroll position.
 *
 * The top HALF, not the whole viewport, is what keeps rule 1 from firing too
 * early: a heading that has only just appeared at the bottom has not arrived,
 * and the chapter above it is still the one being read.
 *
 * Measured against what rule 2 alone does, which was the first attempt: at the
 * moment Genesis 2's heading reached the top it answered "Chapter 3", because
 * Genesis 2 is short enough that 3 already filled more of the screen. True,
 * and not what anybody means.
 *
 * Measured in SCREEN pixels via `lineBlockAt`, which answers for unrendered
 * positions too (CodeMirror estimates their heights), so this does not depend
 * on what happens to be in the DOM. A clipped chapter has zero height and
 * therefore contributes nothing, which is what a hidden chapter should do.
 */
export function chapterInView(view: EditorView): Where | null {
  const structure = structureAt(view.state);
  const chapters = structure.chapters;
  if (chapters.length === 0) return null;

  const box = view.scrollDOM.getBoundingClientRect();
  const docTop = view.documentTop;
  const end = view.state.doc.length;

  const middle = box.top + (box.bottom - box.top) / 2;
  let heading: (typeof chapters)[number] | undefined;
  let best: (typeof chapters)[number] | undefined;
  let bestSeen = -1;
  for (const chapter of chapters) {
    const top = docTop + view.lineBlockAt(Math.min(chapter.from, end)).top;
    if (top >= box.bottom) break;
    const bottom = docTop + view.lineBlockAt(Math.min(chapter.to, end)).bottom;
    if (bottom <= box.top) continue;
    // Rule 1. A zero-height chapter (clipped away) has its heading nowhere and
    // must not claim the crumb, so the span has to be real.
    if (bottom > top && top >= box.top && top <= middle) heading = chapter;
    const seen = Math.min(bottom, box.bottom) - Math.max(top, box.top);
    if (seen > bestSeen) {
      bestSeen = seen;
      best = chapter;
    }
  }
  best = heading ?? best;

  // Nothing intersects — a viewport past the end, or a document of one empty
  // line. The first row is the honest answer and it is never wrong by much.
  const found = best ?? chapters[0];
  return found === undefined ? null : { ordinal: found.ordinal, label: found.label };
}

/** Every chapter of this view's book, front matter row included. */
export function chapterList(view: EditorView): readonly Where[] {
  return structureAt(view.state).chapters.map((chapter) => ({
    ordinal: chapter.ordinal,
    label: chapter.label,
  }));
}

/**
 * Calls `report` whenever the chapter in view may have changed: on scroll,
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
    report(chapterInView(view));
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
