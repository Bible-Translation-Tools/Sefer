/**
 * Every card's view on one screen, by card key — the reader's state, held for
 * the life of the screen and not of the card component (see `cardState.ts`).
 *
 * The key is what the card is ABOUT: a verse's sid on the excerpt screens (a
 * widening is about the verse wherever it is shown, so a verse in two Findings
 * sections is widened in both), a hunk's key on Review.
 *
 * `extents` is its own memo because widening is the one part of a view that
 * changes what the list is built from — Review re-prepares a book when one of
 * its cards widens — and toggling a card's USFM must not.
 */

import { createMemo, createSignal, untrack, type Accessor } from "solid-js";

import type { Extent } from "#core/excerpts/excerpts";

import { CARD_VIEW, reduce, sameExtent, type CardEvent, type CardView } from "./cardState";

export interface CardViews<Drawn> {
  /** One card's view, tracked. */
  readonly view: (key: string) => CardView;
  readonly send: (key: string, event: CardEvent) => void;
  /** Every widened card's reach, changing only when a reach does. */
  readonly extents: Accessor<ReadonlyMap<string, Extent>>;
  /** One card's reach, untracked — for a builder that is re-run by `extents`. */
  readonly extentOf: (key: string) => Extent | undefined;
  /**
   * The card being edited, as it was last drawn — context and all — so a card
   * whose result the edit ended stays what the reader was looking at rather
   * than the snapshot the edit took when it started. Not reactive: it is read
   * once, when the result goes.
   */
  readonly drawn: {
    readonly set: (key: string, drawn: Drawn) => void;
    readonly get: (key: string) => Drawn | undefined;
  };
}

export const createCardViews = <Drawn>(name: string): CardViews<Drawn> => {
  const [views, setViews] = createSignal<ReadonlyMap<string, CardView>>(new Map(), {
    name: `${name}Views`,
  });

  const extents = createMemo<ReadonlyMap<string, Extent>>(
    () => {
      const out = new Map<string, Extent>();
      for (const [key, view] of views()) if (view.extent !== undefined) out.set(key, view.extent);
      return out;
    },
    {
      name: `${name}Extents`,
      equals: (a, b) =>
        a.size === b.size && [...a].every(([key, extent]) => sameExtent(extent, b.get(key))),
    },
  );

  // One entry: only the card being edited is ever read back.
  let held: { readonly key: string; readonly drawn: Drawn } | undefined;

  return {
    view: (key) => views().get(key) ?? CARD_VIEW,
    send: (key, event) =>
      setViews((was) => {
        const next = new Map(was);
        next.set(key, reduce(was.get(key) ?? CARD_VIEW, event));
        return next;
      }),
    extents,
    extentOf: (key) => untrack(extents).get(key),
    drawn: {
      set: (key, drawn) => {
        held = { key, drawn };
      },
      get: (key) => (held?.key === key ? held.drawn : undefined),
    },
  };
};
