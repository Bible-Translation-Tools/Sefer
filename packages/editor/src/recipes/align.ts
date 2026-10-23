import { EditorView } from "@codemirror/view";
import type { BookId } from "@sefer/text/book";
import { tocViewOf } from "@sefer/text/engine/location";
import type { Address } from "@sefer/text/location/address";
import { addressAt, resolve, type TocView } from "@sefer/text/location/locate";

import { structureAt } from "../core/docStructure";
import { markMoved, viewOf, type EditorHandle } from "../handle";

export type AlignMode = "reveal" | "exact";

interface Anchor {
  readonly address: Address;
  readonly below: number;
}

const tocOf = (view: EditorView): TocView | undefined => {
  const analysis = structureAt(view.state).analysis;
  if (analysis === null || analysis.text.length !== view.state.doc.length) return undefined;
  return tocViewOf(analysis);
};

const pixelsBelowTop = (view: EditorView, offset: number): number => {
  const at = Math.min(offset, view.state.doc.length);
  const edge = view.scrollDOM.getBoundingClientRect().top;
  const drawn = view.coordsAtPos(at);
  if (drawn !== null) return drawn.top - edge;
  return view.documentTop + view.lineBlockAt(at).top - edge;
};

const BAND = { from: 0.2, to: 0.75 };

/**
 * Bring `at` to the middle of `view` unless it is already in the middle band.
 * The one reveal for every pair — the aligned group's, and the reference's
 * paired block when the caret moves — so reading down the middle of a page
 * moves nothing, and what reaches an edge comes back to the centre. Returns
 * whether it scrolled.
 */
export const revealInBand = (view: EditorView, at: number): boolean => {
  const height = view.scrollDOM.clientHeight;
  const now = pixelsBelowTop(view, at);
  if (now >= height * BAND.from && now <= height * BAND.to) return false;
  markMoved(view);
  view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "center" }) });
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const landed = pixelsBelowTop(view, at);
      if (Math.abs(landed - (height - view.defaultLineHeight) / 2) > view.defaultLineHeight)
        markMoved(view);
      view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "center" }) });
    }),
  );
  return true;
};

const anchorAt = (view: EditorView, book: BookId): Anchor | undefined => {
  const toc = tocOf(view);
  if (toc === undefined) return undefined;
  const box = view.scrollDOM.getBoundingClientRect();
  const middle = box.top + box.height / 2;
  const top =
    view.posAtCoords({ x: box.left + box.width / 2, y: middle }, false) ??
    view.lineBlockAtHeight(middle - view.documentTop).from;
  let address = addressAt(book, toc, top);
  if (address === undefined) return undefined;
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
  if (mode === "reveal") return revealInBand(view, at);
  const margin = Math.max(0, anchor.below);
  if (Math.abs(pixelsBelowTop(view, at) - margin) < 1) return false;
  markMoved(view);
  view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "start", yMargin: margin }) });
  return true;
};

const INPUT_MS = 800;

const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);

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
  readonly editor: EditorHandle;
  readonly book: BookId;
  /** Its scroll moves the others. Read on each scroll, so a toggle takes effect at once. */
  readonly leads?: () => boolean;
  /** It is moved by the others'. */
  readonly follows?: () => boolean;
}

export interface AlignedGroup {
  /** Join the group; returns leave. A follower is brought to the current lead on joining. */
  join(member: AlignedMember): () => void;
  /** Bring `editor` to the current lead now — after its text arrives, or its Follow is turned on. */
  sync(editor: EditorHandle): void;
  /**
   * `editor` was moved on purpose — a chapter picked, a search hit opened — and
   * the others should follow it, as if the reader had scrolled there. Read
   * once the move has landed.
   */
  lead(editor: EditorHandle): void;
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
  let lead: { readonly from: EditorHandle; readonly anchor: Anchor } | undefined;

  const place = (member: AlignedMember, anchor: Anchor): void => {
    if (member.follows?.() === false) return;
    alignTo(viewOf(member.editor), member.book, anchor, mode);
  };
  const from = (member: AlignedMember, anchor: Anchor): void => {
    if (member.leads?.() === false) return;
    lead = { from: member.editor, anchor };
    for (const other of members) if (other !== member) place(other, anchor);
  };

  return {
    join(member) {
      members.add(member);
      const unwatch = watchAnchor(viewOf(member.editor), member.book, (anchor) =>
        from(member, anchor),
      );
      if (lead !== undefined && lead.from !== member.editor) place(member, lead.anchor);
      return () => {
        unwatch();
        members.delete(member);
        if (lead?.from === member.editor) lead = undefined;
      };
    },
    sync(editor) {
      if (lead === undefined || lead.from === editor) return;
      for (const member of members) if (member.editor === editor) place(member, lead.anchor);
    },
    lead(editor) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          for (const member of members) {
            if (member.editor !== editor) continue;
            const anchor = anchorAt(viewOf(editor), member.book);
            if (anchor !== undefined) from(member, anchor);
          }
        }),
      );
    },
  };
};
