import { addressCode, type Address } from "@sefer/text/location/address";
import { tocUnits, unitAddress, unitIndexAt, type TocUnit } from "@sefer/text/location/locate";

import type { Extent } from "#core/excerpts/excerpts";
import { tocViewOf, type Analysis } from "#core/galley";
import type { DecisionUnit } from "#core/galley/diff";

import { changed } from "./paint";

export interface Range {
  readonly from: number;
  readonly to: number;
}

export type { Extent } from "#core/excerpts/excerpts";

export interface Hunk {
  readonly bookId: string;
  readonly key: string;
  readonly address: Address;
  readonly label: string;
  readonly units: readonly DecisionUnit[];
  readonly all: readonly DecisionUnit[];
  readonly current: Range;
  readonly baseline: Range | undefined;
  readonly extent: Extent;
  readonly more: { readonly up: boolean; readonly down: boolean };
}

const stretchOf = (
  all: readonly TocUnit[],
  first: number,
  last: number,
  extent: Extent,
): { range: Range; low: number; high: number } => {
  let low: number;
  let high: number;
  if (extent.chapter === true) {
    const row = all[first]?.row;
    low = first;
    high = last;
    while (low > 0 && all[low - 1]?.row === row) low -= 1;
    while (high < all.length - 1 && all[high + 1]?.row === row) high += 1;
  } else {
    low = Math.max(0, first - Math.max(0, extent.up));
    high = Math.min(all.length - 1, last + Math.max(0, extent.down));
  }
  return {
    range: { from: all[low]?.from ?? 0, to: all[high]?.to ?? 0 },
    low,
    high,
  };
};

export const hunksOf = (options: {
  readonly bookId: string;
  readonly units: readonly DecisionUnit[];
  readonly baseline: Analysis;
  readonly current: Analysis;
  readonly label: (address: Address) => string;
  readonly steps: number;
  readonly extentOf?: (key: string) => Extent | undefined;
  readonly include?: (unit: DecisionUnit) => boolean;
  readonly keep?: (unit: DecisionUnit) => boolean;
}): Hunk[] => {
  const currentToc = tocViewOf(options.current);
  const current = tocUnits(currentToc);
  const baseline = tocUnits(tocViewOf(options.baseline));
  const groups = new Map<number, DecisionUnit[]>();
  for (const unit of options.units) {
    const shown = changed(unit) ? options.include?.(unit) !== false : options.keep?.(unit) === true;
    if (!shown) continue;
    const anchor = unit.current?.from ?? Math.max(0, unit.place.current - 1);
    const at = Math.max(0, unitIndexAt(current, anchor));
    const held = groups.get(at);
    if (held === undefined) groups.set(at, [unit]);
    else held.push(unit);
  }

  const count = options.units.length;
  const firstAt = (at: number): number => {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((options.units[mid]?.place.current ?? 0) < at) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const out: Hunk[] = [];
  for (const [at, own] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const toc = current[at];
    if (toc === undefined) continue;
    const address = unitAddress(options.bookId, currentToc, toc);
    const key = `${options.bookId} ${addressCode(address)}`;
    const extent = options.extentOf?.(key) ?? { up: options.steps, down: options.steps };
    const shownCurrent = stretchOf(current, at, at, extent);
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const unit of own)
      if (unit.baseline !== undefined) {
        from = Math.min(from, unit.baseline.from);
        to = Math.max(to, unit.baseline.to);
      }
    const shownBaseline =
      from === Number.POSITIVE_INFINITY
        ? undefined
        : stretchOf(
            baseline,
            Math.max(0, unitIndexAt(baseline, from)),
            Math.max(0, unitIndexAt(baseline, Math.max(from, to - 1))),
            extent,
          ).range;
    const low = firstAt(shownCurrent.range.from);
    let high = firstAt(shownCurrent.range.to);
    while (
      high < count &&
      options.units[high]?.current === undefined &&
      options.units[high]?.place.current === shownCurrent.range.to
    )
      high += 1;
    out.push({
      bookId: options.bookId,
      key,
      address,
      label: options.label(address),
      units: own,
      all: options.units.slice(low, Math.max(low, high)),
      current: shownCurrent.range,
      baseline: shownBaseline,
      extent,
      more: {
        up: extent.chapter !== true && shownCurrent.low > 0,
        down: extent.chapter !== true && shownCurrent.high < current.length - 1,
      },
    });
  }
  return out;
};

const CHARS_PER_LINE = 70;

export const estimate = (hunk: Hunk): number =>
  60 + Math.ceil((hunk.current.to - hunk.current.from) / CHARS_PER_LINE) * 30;

export const isFormatting = (unit: DecisionUnit): boolean =>
  unit.isWhitespaceChange || unit.isUsfmStructureChange;

export const hunkKind = (units: readonly DecisionUnit[]): string | undefined => {
  if (units.length === 0) return undefined;
  const spaces = units.filter((unit) => unit.isWhitespaceChange).length;
  const markup = units.filter(
    (unit) => !unit.isWhitespaceChange && unit.isUsfmStructureChange,
  ).length;
  if (spaces === units.length) return "whitespace only";
  if (markup === units.length) return "markup only";
  if (spaces + markup === units.length) return "markup and whitespace only";
  const parts = [
    markup > 0 ? `${markup} markup only` : "",
    spaces > 0 ? `${spaces} whitespace only` : "",
  ].filter((part) => part !== "");
  return parts.length === 0 ? undefined : parts.join(" · ");
};
