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

/** A chapter, named. What a list of them carries. */
export interface ChapterName {
  /** The index into the engine's chapter table — row 0 is the front matter. */
  readonly ordinal: number;
  /** `\c`'s own number, as written. Empty for the front matter. */
  readonly label: string;
}

/** Where the reader is: a chapter, and how far into the document. */
export interface Where extends ChapterName {
  /**
   * The `\c` label of the chapter the TOP of the viewport is in — which is
   * NOT always `label`, and conflating the two was a bug.
   *
   * `label` answers "which chapter am I reading", and a heading in the top
   * half wins it the moment it lands, while the top edge is still in the
   * chapter above. That is right for the crumb and wrong for a place: the
   * verse scan below is scoped to a chapter, and scoping it to a chapter that
   * has not started yet finds nothing at all.
   *
   * So the crumb reads `label` and the remembered place reads this, and they
   * are allowed to disagree for the width of one heading.
   */
  readonly topChapter?: string;
  /**
   * The verse number at the very TOP of the viewport, as written — `"10"`,
   * `"5-7"` for a bridge — or absent above the first verse of its chapter.
   *
   * With `topChapter` this is the place the reader had got to, and it is what
   * puts them back: a remount builds a new `EditorView`, and where somebody
   * had scrolled to is a fact about a view rather than about the state it is
   * over. A reference rather than an offset, so an edit while they were away
   * moves it with the text instead of pointing at whatever now sits there.
   */
  readonly verse?: string;
  /** The document offset at the very top of the viewport. */
  readonly top: number;
  /**
   * The content hash of the document `top` was read from, as a string.
   *
   * `Analysis.sourceHash`, taken off the parse this view had already done —
   * nothing is hashed to produce it. Absent when the state carries no analysis
   * yet, which is the moment before the first parse lands.
   */
  readonly hash?: string;
  /** The document's length when `top` was read — see `LastLocation.place`. */
  readonly length: number;
}

/**
 * Which chapter the reader is in.
 *
 * Not simply the chapter under the scroller's TOP EDGE: that reading is
 * twitchy in exactly the place it is read most. Scroll a chapter heading two
 * lines past the top and a few lines of the previous chapter are still
 * showing: the top edge is in chapter 3, the reader is plainly in chapter 4,
 * and every reference pane would snap back a chapter.
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
function chapterInView(view: EditorView): Where | null {
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
  if (found === undefined) return null;

  // The START of the first line the reader can see.
  //
  // `lineBlockAtHeight` and not `posAtCoords`, which rounds to the nearest
  // position and so returned the NEXT line's start whenever the first line was
  // partly scrolled off — leaving on verse 6 and coming back on verse 7. A
  // line block is the line itself, and its `from` is where it begins.
  const top = view.lineBlockAtHeight(box.top - docTop + 1).from;
  // The chapter `top` is actually in — see `topChapter`. Scanned rather than
  // assumed to be `found`, which is the chapter FILLING the viewport.
  let holder: (typeof chapters)[number] | undefined;
  for (const chapter of chapters) {
    if (chapter.from > top) break;
    holder = chapter;
  }
  // And the verse that offset is in, from this view's own table, scoped to
  // that chapter — verse numbers repeat, and `10` alone names sixty places.
  const rows = structureAt(view.state).verses;
  let verse: string | undefined;
  for (const row of rows) {
    if (holder !== undefined && row.markerFrom < holder.from) continue;
    if (row.markerFrom > top) break;
    verse = row.num ?? undefined;
  }
  const hash = structureAt(view.state).analysis?.sourceHash;
  return {
    ordinal: found.ordinal,
    label: found.label,
    top,
    length: view.state.doc.length,
    ...(hash === undefined ? {} : { hash: String(hash) }),
    ...(holder === undefined ? {} : { topChapter: holder.label }),
    ...(verse === undefined ? {} : { verse }),
  };
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
