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
   * Where the line holding `top` ends. In Regular a visual line can open with
   * a bare `\q1` that belongs to the unit BEFORE, so "which unit is at the
   * top" reads the end of the line, not its start (Review's counter).
   */
  readonly topLineEnd: number;
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
    if (bottom > top && top >= box.top && top <= middle) heading = chapter;
    const seen = Math.min(bottom, box.bottom) - Math.max(top, box.top);
    if (seen > bestSeen) {
      bestSeen = seen;
      best = chapter;
    }
  }
  best = heading ?? best;

  const found = best ?? chapters[0];
  if (found === undefined) return null;

  const top = view.lineBlockAtHeight(box.top - docTop + 1).from;
  let holder: (typeof chapters)[number] | undefined;
  for (const chapter of chapters) {
    if (chapter.from > top) break;
    holder = chapter;
  }
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
    topLineEnd: view.lineBlockAt(top).to,
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
