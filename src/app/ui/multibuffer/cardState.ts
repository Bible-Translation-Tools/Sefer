import type { Extent } from "#core/excerpts/excerpts";

export type ContextStep = "up" | "down" | "chapter" | "fold";

export interface CardView {
  readonly extent?: Extent;
  readonly usfm: boolean;
  readonly open: ReadonlySet<string>;
}

export const CARD_VIEW: CardView = { usfm: false, open: new Set() };

export type CardEvent =
  | { readonly kind: "step"; readonly step: ContextStep; readonly from: Extent }
  | { readonly kind: "usfm" }
  | { readonly kind: "open"; readonly id: string };

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

export const widened = (now: Extent): boolean => now.chapter === true || now.up > 0 || now.down > 0;

const flip = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

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

export const sameExtent = (a: Extent | undefined, b: Extent | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.up === b.up &&
    a.down === b.down &&
    (a.chapter === true) === (b.chapter === true) &&
    sameExtent(a.folded, b.folded));
