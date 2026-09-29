/**
 * What a windowed list does with its scroll position, as pure decisions.
 *
 * `VirtualList` binds `@tanstack/virtual-core` to Solid; every question it asks
 * about WHERE the reader should be is answered here, over plain numbers and
 * keys, so the answers can be read, reasoned about and tested without a DOM.
 * Each rule is here because a case broke without it; the case is on the rule.
 *
 * The reader's place in a list is a ROW, never a number of pixels: pixels are
 * a measurement of whatever results happen to be above it.
 */

/**
 * What a rebuild of the list does to the reader's place.
 *
 * - `top`: every row that was on screen is gone — a fresh query, a regrouping.
 *   A scroll offset into somebody else's results is not a place, so a new
 *   list starts at its top.
 * - `hold`: keep `anchor` where the reader saw it. Rows added or removed above
 *   it — a result an edit created or ended — would otherwise move it, because
 *   the scroll offset alone stays put: an edit that added a finding above the
 *   card being typed in pushed that card 201px down the screen.
 * - `stay`: nothing was on screen yet; there is no place to keep.
 */
export type Rebuild =
  | { readonly kind: "top" }
  | { readonly kind: "hold"; readonly anchor: string }
  | { readonly kind: "stay" };

/**
 * `onScreen` is the rows last drawn, `pinned` the row being edited, `has` asks
 * the NEW list. The pinned row is the anchor when it survives: it is the one
 * the reader is typing in. Otherwise the first row on screen that survives.
 */
export const rebuild = (
  onScreen: readonly string[],
  pinned: string | undefined,
  has: (key: string) => boolean,
): Rebuild => {
  if (onScreen.length === 0) return { kind: "stay" };
  if (!onScreen.some(has)) return { kind: "top" };
  if (pinned !== undefined && has(pinned)) return { kind: "hold", anchor: pinned };
  const first = onScreen.find(has);
  return first === undefined ? { kind: "stay" } : { kind: "hold", anchor: first };
};

/**
 * The scroll offset that keeps a held row where it was: moved by exactly as
 * much as the row's own start moved. `before` or `after` unknown is no move.
 */
export const heldOffset = (
  scrollTop: number,
  before: number | undefined,
  after: number | undefined,
): number => (before === undefined || after === undefined ? scrollTop : scrollTop + after - before);

/** One height correction, as the library reports it. */
export interface Correction {
  readonly index: number;
  /** Has this row been measured before? A first measurement is not a change. */
  readonly remeasured: boolean;
  readonly start: number;
  readonly size: number;
  /** The row being edited, if any. */
  readonly pinnedIndex: number | undefined;
  /** The top of the viewport, adjustments included. */
  readonly fold: number;
}

/**
 * Does a height correction move the viewport to hold the reader still?
 *
 * 1. Above a row being edited, always — a first measurement too. An edit that
 *    adds a result above the card it is typed in inserts a row there, and its
 *    first measurement would push the card down the screen.
 * 2. Otherwise, never for a FIRST measurement. Every row is measured for the
 *    first time once, and compensating those moves the viewport by the sum of
 *    every estimate's error: that walked `/findings` 8,154px down a list the
 *    reader had not touched, and dragged a fresh query back to the offset the
 *    previous results were left at.
 * 3. A re-measurement (a card opened for editing, a verse widened) is held
 *    when the row sits wholly above the fold — what the reader has already
 *    scrolled past.
 */
export const compensates = (c: Correction): boolean => {
  if (c.pinnedIndex !== undefined && c.index < c.pinnedIndex) return true;
  if (!c.remeasured) return false;
  if (c.fold <= 0) return false;
  return c.start + c.size <= c.fold;
};

/**
 * A jump in flight.
 *
 * The library's `scrollToIndex` aims from ESTIMATES and stops after one frame
 * without movement — before this list's rows report their real heights, a
 * frame or more later. The rows above the target then grow, and a first jump
 * into a book landed short (the tail of 3 John above Jude 1:1). So a jump
 * re-aims each frame until its target has held still for `STILL` frames, and
 * gives up after `FRAMES`. The reader's own input ends it; that is the binding's.
 */
export type Aim =
  | { readonly kind: "aiming"; readonly still: number; readonly frames: number }
  | { readonly kind: "settled" };

export const AIMING: Aim = { kind: "aiming", still: 0, frames: 0 };

const STILL = 3;
const FRAMES = 60;

/**
 * One frame of a jump. `target` is where the row is now, already clamped to
 * the list's bottom, so a short last section settles there like any other.
 * `scrollTo` is set when this frame must move the viewport.
 */
export const aimStep = (
  aim: Aim,
  scrollTop: number,
  target: number | undefined,
): { readonly aim: Aim; readonly scrollTo?: number } => {
  if (aim.kind === "settled") return { aim };
  const frames = aim.frames + 1;
  if (target === undefined || frames > FRAMES) return { aim: { kind: "settled" } };
  if (Math.abs(scrollTop - target) > 1)
    return { aim: { kind: "aiming", still: 0, frames }, scrollTo: target };
  const still = aim.still + 1;
  return still >= STILL ? { aim: { kind: "settled" } } : { aim: { kind: "aiming", still, frames } };
};
