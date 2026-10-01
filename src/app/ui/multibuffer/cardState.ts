/**
 * What a reader has done to one card, and the one rule for each thing they can
 * do — pure, over plain values.
 *
 * A card's own view (how much context it shows, whether it reads as USFM,
 * which of its lines are unfolded) is the READER's, not the card component's:
 * the list unmounts a card that scrolls out of its window, so state held in
 * the component went with it — switch a card to USFM, scroll away and back,
 * and it was in the reading again. `cardViews.ts` holds these by card key for
 * the life of the screen; this file says what each event does to one.
 */

import type { Extent } from "#core/excerpts/excerpts";

/** One press of the context control. */
export type ContextStep = "up" | "down" | "chapter" | "fold";

/** One card's view. `extent` absent is the screen's starting reach. */
export interface CardView {
  readonly extent?: Extent;
  /** This card alone in USFM, over the screen's mode. */
  readonly usfm: boolean;
  /** Lines inside the card the reader has unfolded — Findings' identical runs. */
  readonly open: ReadonlySet<string>;
}

export const CARD_VIEW: CardView = { usfm: false, open: new Set() };

/**
 * What a reader can do to a card. `from` on a step is the screen's starting
 * reach, for a card nobody has widened yet.
 */
export type CardEvent =
  | { readonly kind: "step"; readonly step: ContextStep; readonly from: Extent }
  | { readonly kind: "usfm" }
  | { readonly kind: "open"; readonly id: string };

/**
 * A card's reach after one press — the ONE rule every list applies. Fold is
 * the unit alone, whatever the setting started it at, and remembers the reach
 * it folded, so pressing it again unfolds to exactly that; any other step
 * starts from where the card is and forgets it.
 */
const stepExtent = (now: Extent, step: ContextStep): Extent => {
  if (step === "fold") {
    if (now.folded !== undefined) return now.folded;
    return widened(now) ? { up: 0, down: 0, folded: now } : now;
  }
  const at: Extent = {
    up: now.up,
    down: now.down,
    ...(now.chapter === true ? { chapter: true } : {}),
  };
  return step === "chapter"
    ? { up: at.up, down: at.down, chapter: at.chapter !== true }
    : step === "up"
      ? { up: at.up + 1, down: at.down }
      : { up: at.up, down: at.down + 1 };
};

/** Whether a card shows anything beyond its own unit. */
export const widened = (now: Extent): boolean => now.chapter === true || now.up > 0 || now.down > 0;

const flip = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** One event, applied to one card's view. */
export const reduce = (view: CardView, event: CardEvent): CardView => {
  switch (event.kind) {
    case "step":
      return { ...view, extent: stepExtent(view.extent ?? event.from, event.step) };
    case "usfm":
      return { ...view, usfm: !view.usfm };
    case "open":
      return { ...view, open: flip(view.open, event.id) };
  }
};

/** The same reach, as a value: what decides whether a widening re-prepares anything. */
export const sameExtent = (a: Extent | undefined, b: Extent | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.up === b.up &&
    a.down === b.down &&
    (a.chapter === true) === (b.chapter === true) &&
    sameExtent(a.folded, b.folded));
