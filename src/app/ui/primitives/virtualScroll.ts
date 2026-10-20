export type Rebuild =
  | { readonly kind: "top" }
  | { readonly kind: "hold"; readonly anchor: string }
  | { readonly kind: "stay" };

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

export const heldOffset = (
  scrollTop: number,
  before: number | undefined,
  after: number | undefined,
): number => (before === undefined || after === undefined ? scrollTop : scrollTop + after - before);

export interface Correction {
  readonly index: number;
  readonly remeasured: boolean;
  readonly start: number;
  readonly size: number;
  readonly pinnedIndex: number | undefined;
  readonly fold: number;
}

export const compensates = (c: Correction): boolean => {
  if (c.pinnedIndex !== undefined && c.index < c.pinnedIndex) return true;
  if (!c.remeasured) return false;
  if (c.fold <= 0) return false;
  return c.start + c.size <= c.fold;
};

export type Aim =
  | { readonly kind: "aiming"; readonly still: number; readonly frames: number }
  | { readonly kind: "settled" };

export const AIMING: Aim = { kind: "aiming", still: 0, frames: 0 };

const STILL = 3;
const FRAMES = 60;

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
