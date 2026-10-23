import { createMemo, createSignal, untrack, type Accessor } from "solid-js";

import type { Extent } from "#core/excerpts/excerpts";

import { CARD_VIEW, reduce, sameExtent, type CardEvent, type CardView } from "./cardState";

export interface CardViews<Drawn> {
  readonly view: (key: string) => CardView;
  readonly send: (key: string, event: CardEvent) => void;
  readonly extents: Accessor<ReadonlyMap<string, Extent>>;
  // Untracked: a builder re-run by `extents` must not subscribe to one card.
  readonly extentOf: (key: string) => Extent | undefined;
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
