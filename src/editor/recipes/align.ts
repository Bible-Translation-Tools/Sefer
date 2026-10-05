/**
 * Two editors over two texts of the same book, kept at the same VERSE.
 *
 * Not the same scroll position: two texts of one book are different lengths
 * — another translation, the version before, a reviewer who deleted a run of
 * `\q` lines — so a pixel or a fraction in one means nothing in the other, and
 * following by place moved the other pane by a screen for a small scroll once
 * the heights drifted. The one thing both texts agree about is the ADDRESS:
 * Location's `addressAt` names the verse at an offset in one table of
 * contents, and `resolve` finds that verse in the other — the same pair of
 * calls Find uses to put a reference hit on the project's own verse, so a
 * bridge (`\v 1-2` here, `\v 1` there) lands where it should.
 *
 * Two halves, so a caller that holds only one of the views can still follow:
 *
 *  - `anchorAt(view, book)` — the verse at the top of a view, and how far
 *    below the top edge it starts.
 *  - `alignTo(view, book, anchor, mode)` — bring that verse into this view.
 *
 * and `watchAnchor`, the event a view emits when it scrolls. What follows what
 * is decided by whatever holds the views side by side
 * (`src/app/ui/aligned.ts`): it keeps the lead, and the views stay
 * independent of each other.
 *
 * ## Two modes
 *
 *  - `reveal` (the default) — move only when the verse is not already on
 *    screen. A pane that re-scrolls under every pixel of the other is
 *    tiring to read beside; one that stays put until what you scrolled to is
 *    out of its sight, and then brings it to the top, is a linkage you notice
 *    only when it helps.
 *  - `exact` — the verse at the same height in both, every time.
 *
 * A place with no verse (the front matter, a chapter's heading before `\v 1`)
 * is an address too — `intro`, `chapters` — and resolves the same way.
 */

import { EditorView } from "@codemirror/view";

import type { BookId } from "#core/book/book";
import { tocViewOf } from "#core/galley/location";
import type { Address } from "#core/location/address";
import { addressAt, resolve, type TocView } from "#core/location/locate";

import { structureAt } from "../core/docStructure";

export type AlignMode = "reveal" | "exact";

/** Where a view is, as something another text can find. */
interface Anchor {
  readonly address: Address;
  /** Pixels from the scroller's top edge to where the address starts; negative once it has scrolled above. */
  readonly below: number;
}

const tocOf = (view: EditorView): TocView | undefined => {
  const analysis = structureAt(view.state).analysis;
  // A view whose parse has not landed has no table to read; and a parse of
  // an older text than the view holds would name the wrong verse.
  if (analysis === null || analysis.text.length !== view.state.doc.length) return undefined;
  return tocViewOf(analysis);
};

/** Where `offset` sits, in pixels below the scroller's top edge. */
const pixelsBelowTop = (view: EditorView, offset: number): number => {
  const block = view.lineBlockAt(Math.min(offset, view.state.doc.length));
  return view.documentTop + block.top - view.scrollDOM.getBoundingClientRect().top;
};

/** The verse (or heading, or front matter) at the top of `view`. */
const anchorAt = (view: EditorView, book: BookId): Anchor | undefined => {
  const toc = tocOf(view);
  if (toc === undefined) return undefined;
  const box = view.scrollDOM.getBoundingClientRect();
  // The first line block the reader can see — `lineBlockAtHeight`, not
  // `posAtCoords`, for the reason `whereAmI` gives.
  const top = view.lineBlockAtHeight(box.top - view.documentTop + 1).from;
  let address = addressAt(book, toc, top);
  if (address === undefined) return undefined;
  // A heading or a chapter's title at the top names the whole chapter, whose
  // start may be screens above: the other view would be sent back there. The
  // first VERSE in sight is the place being read.
  if (address.kind !== "verses") {
    const bottom = box.bottom - view.documentTop;
    for (let at = top; at < view.state.doc.length;) {
      const block = view.lineBlockAt(at);
      if (block.top > bottom) break;
      const here = addressAt(book, toc, block.from);
      if (here?.kind === "verses") {
        address = here;
        break;
      }
      at = block.to + 1;
    }
  }
  const found = resolve(toc, address);
  const start = found.kind === "found" ? found.from : top;
  return { address, below: pixelsBelowTop(view, start) };
};

/** Bring `anchor` into `view`. Returns whether it scrolled. */
const alignTo = (
  view: EditorView,
  book: BookId,
  anchor: Anchor,
  mode: AlignMode = "reveal",
): boolean => {
  const toc = tocOf(view);
  if (toc === undefined) return false;
  const address = anchor.address.kind === "book" ? anchor.address : { ...anchor.address, book };
  const found = resolve(toc, address);
  // A verse this text does not have: its chapter, which `missing` names.
  let at: number | undefined;
  if (found.kind === "found") at = found.from;
  else if (found.kind === "ambiguous") at = found.spans[0]?.from;
  else if (address.kind === "verses") {
    const chapter = resolve(toc, {
      kind: "chapters",
      book,
      from: address.from.chapter,
      to: address.from.chapter,
    });
    if (chapter.kind === "found") at = chapter.from;
  }
  if (at === undefined) return false;
  const now = pixelsBelowTop(view, at);
  const margin = mode === "reveal" ? 0 : Math.max(0, anchor.below);
  if (mode === "reveal") {
    const height = view.scrollDOM.clientHeight;
    // On screen already, with a line's grace at either edge: leave it be.
    if (now >= 0 && now < height - 24) return false;
  } else if (Math.abs(now - margin) < 1) return false;
  // CodeMirror's own scroll, not `scrollTop`: a verse three screens away sits
  // in lines it has only ESTIMATED the height of, and arithmetic on estimates
  // landed a verse off. Its scroll measures as it goes.
  view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "start", yMargin: margin }) });
  return true;
};

/** How long after the reader's own input a scroll is still theirs: a trackpad's momentum outlasts the last wheel event. */
const INPUT_MS = 800;

/** Keys that scroll a view by themselves. */
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);

/**
 * Calls `report` with the view's anchor when the READER scrolls it — the
 * event a view emits to whatever holds it beside another.
 *
 * Only the reader's scroll. A view also scrolls on its own — the caret
 * brought into view, a paired block revealed, another view's alignment — and
 * reporting those made the views answer each other: a click in the editor
 * revealed the pair in a reference, whose scroll led the editor back. So a
 * scroll is reported only inside a moment of the reader's own input on this
 * view: the wheel, a touch, a drag on its scrollbar, a key that scrolls. A
 * jump the app makes on purpose is announced instead (`AlignedGroup.lead`).
 *
 * One passive listener, coalesced into an animation frame like
 * `watchLocation`. Returns the detach.
 */
function watchAnchor(view: EditorView, book: BookId, report: (anchor: Anchor) => void): () => void {
  let inputAt = Number.NEGATIVE_INFINITY;
  const touched = (): void => {
    inputAt = performance.now();
  };
  const dragging = (event: PointerEvent): void => {
    if (event.buttons !== 0) touched();
  };
  const keyed = (event: KeyboardEvent): void => {
    if (SCROLL_KEYS.has(event.key)) touched();
  };
  let queued = false;
  const read = (): void => {
    queued = false;
    const anchor = anchorAt(view, book);
    if (anchor !== undefined) report(anchor);
  };
  const onScroll = (): void => {
    if (performance.now() - inputAt > INPUT_MS || queued) return;
    queued = true;
    requestAnimationFrame(read);
  };
  const scroller = view.scrollDOM;
  scroller.addEventListener("wheel", touched, { passive: true });
  scroller.addEventListener("touchmove", touched, { passive: true });
  scroller.addEventListener("pointermove", dragging, { passive: true });
  view.dom.addEventListener("keydown", keyed);
  scroller.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    scroller.removeEventListener("wheel", touched);
    scroller.removeEventListener("touchmove", touched);
    scroller.removeEventListener("pointermove", dragging);
    view.dom.removeEventListener("keydown", keyed);
    scroller.removeEventListener("scroll", onScroll);
  };
}

/** One editor in an aligned group, and what it does there. */
export interface AlignedMember {
  readonly view: EditorView;
  readonly book: BookId;
  /** Its scroll moves the others. Read on each scroll, so a toggle takes effect at once. */
  readonly leads?: () => boolean;
  /** It is moved by the others'. */
  readonly follows?: () => boolean;
}

export interface AlignedGroup {
  /** Join the group; returns leave. A follower is brought to the current lead on joining. */
  join(member: AlignedMember): () => void;
  /** Bring `view` to the current lead now — after its text arrives, or its Follow is turned on. */
  sync(view: EditorView): void;
  /**
   * `view` was moved on purpose — a chapter picked, a search hit opened — and
   * the others should follow it, as if the reader had scrolled there. Read
   * once the move has landed.
   */
  lead(view: EditorView): void;
}

/**
 * The lead, held by whatever shows the editors side by side — the state lifted
 * out of the views, which emit (`watchAnchor`) and are told (`alignTo`) and
 * know nothing of each other. Plain, not reactive: it relays an event, and
 * nothing renders from it.
 *
 * One hop and done: the reader scrolls one view, the others are moved, and a
 * moved view does not lead — it had no input from the reader — so nothing
 * comes back.
 */
export const createAlignedGroup = (mode: AlignMode = "reveal"): AlignedGroup => {
  const members = new Set<AlignedMember>();
  let lead: { readonly from: EditorView; readonly anchor: Anchor } | undefined;

  const place = (member: AlignedMember, anchor: Anchor): void => {
    if (member.follows?.() === false) return;
    alignTo(member.view, member.book, anchor, mode);
  };
  const from = (member: AlignedMember, anchor: Anchor): void => {
    if (member.leads?.() === false) return;
    lead = { from: member.view, anchor };
    for (const other of members) if (other !== member) place(other, anchor);
  };

  return {
    join(member) {
      members.add(member);
      const unwatch = watchAnchor(member.view, member.book, (anchor) => from(member, anchor));
      if (lead !== undefined && lead.from !== member.view) place(member, lead.anchor);
      return () => {
        unwatch();
        members.delete(member);
        if (lead?.from === member.view) lead = undefined;
      };
    },
    sync(view) {
      if (lead === undefined || lead.from === view) return;
      for (const member of members) if (member.view === view) place(member, lead.anchor);
    },
    lead(view) {
      // Two frames: the move is CodeMirror's, and it lands in its next measure.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          for (const member of members) {
            if (member.view !== view) continue;
            const anchor = anchorAt(view, member.book);
            if (anchor !== undefined) from(member, anchor);
          }
        }),
      );
    },
  };
};
