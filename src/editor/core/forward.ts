/**
 * Carrying a published range forward through edits made since it was measured.
 *
 * ONE rule, for every surface that draws a range somebody else computed — a
 * card's marks (`recipes/satellite.ts`) and the editor's proofreading
 * underlines (`recipes/lint.ts`): a range an edit did not touch is mapped
 * through the change and keeps describing the same text; a range the edit
 * touched (overlapped or abutted) no longer describes what the reader just
 * changed and is dropped. The next publication paints what is true, including
 * anything the edit introduced.
 */

import type { ChangeDesc } from "@codemirror/state";

/** Does `changes` touch `[from, to]`, in the AFTER document's coordinates? */
export const touchedBy = (changes: ChangeDesc): ((from: number, to: number) => boolean) => {
  const touched: { from: number; to: number }[] = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => touched.push({ from: fromB, to: toB }));
  return (from, to) => touched.some((range) => range.from <= to && range.to >= from);
};

/** `ranges` mapped through `changes`, without the ones the edit touched. */
export const carryForward = <T extends { readonly from: number; readonly to: number }>(
  ranges: readonly T[],
  changes: ChangeDesc,
): readonly T[] => {
  if (ranges.length === 0 || changes.empty) return ranges;
  const touched = touchedBy(changes);
  const out: T[] = [];
  for (const range of ranges) {
    const from = changes.mapPos(range.from, 1);
    const to = Math.max(from, changes.mapPos(range.to, -1));
    if (touched(from, to)) continue;
    out.push(from === range.from && to === range.to ? range : { ...range, from, to });
  }
  return out;
};
