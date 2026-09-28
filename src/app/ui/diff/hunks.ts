/**
 * Changes as cards: one card per TOC unit that changed — a verse, a bridge, a
 * chapter's head — the way Find has one card per verse with a hit.
 *
 * A card is its TOC unit, not a cluster of changes: every change the engine
 * reports inside one unit is on that one card, and the card's key is the
 * unit's address (`"<book> <address>"`, the excerpt's own key), so it does not
 * move when a change appears or disappears around it — typing into the verse
 * above makes a card for the verse above, and the card being edited stays the
 * card it was.
 *
 * Context is TOC steps either side, like every excerpt: the setting's steps to
 * start (`excerpts.context`), a card's own widening after that, or its whole
 * chapter. Neighbouring cards may show the same context verses, as Find's do.
 * Spans are into each side's own document, so a card clips each text to its
 * own stretch and the diff view paints on it; every change inside the stretch
 * is painted, and the card's OWN changes are the ones it decides.
 */

import type { Extent } from "#core/excerpts/excerpts";
import { tocViewOf, type Analysis } from "#core/galley";
import { unitReference, type DecisionUnit } from "#core/galley/diff";
import { addressCode } from "#core/location/address";
import { tocUnits, unitAddress, unitIndexAt, type TocUnit } from "#core/location/locate";

import { changed } from "./paint";

export interface Range {
  readonly from: number;
  readonly to: number;
}

/** How far a card reaches beyond its own unit — the excerpt's own extent, one type for every card. */
export type { Extent } from "#core/excerpts/excerpts";

/** One card: a TOC unit that changed, and the stretch of each text it shows. */
export interface Hunk {
  readonly bookId: string;
  /** `"<book> <address>"` — stable while the unit is: the list's row key. */
  readonly key: string;
  /** Its own unit's reference ("1:4"): the card's title, kept when its changes go. */
  readonly reference: string;
  /** The engine's changes inside this unit: what the card decides. */
  readonly units: readonly DecisionUnit[];
  /**
   * The book's units inside this card's stretch, in reading order: what the
   * card paints — its own changes and any in its context.
   */
  readonly all: readonly DecisionUnit[];
  /** What the current text shows. */
  readonly current: Range;
  /** What the baseline text shows; absent when every change here is current-only. */
  readonly baseline: Range | undefined;
  readonly extent: Extent;
  /** Whether one more TOC step is there to take, above and below. */
  readonly more: { readonly up: boolean; readonly down: boolean };
}

/** The stretch around units `[first, last]` of `all`, by `extent`. */
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

/**
 * One book's changes as cards, one per TOC unit.
 *
 * `units` is the book's units in reading order, as the engine sends them:
 * the changed ones, plus any unchanged ones it was asked for. A one-sided unit
 * is placed by its own `place` — where the text that lacks it would have it —
 * so nothing here walks the units around it. `include` narrows which changes
 * get a card — the kind filter; `keep` gives an unchanged unit a card anyway
 * (Review's editable result, a taken unit that must not vanish the moment it
 * is taken).
 */
export const hunksOf = (options: {
  readonly bookId: string;
  readonly units: readonly DecisionUnit[];
  readonly baseline: Analysis;
  readonly current: Analysis;
  /** The setting's steps, for a card nobody has widened. */
  readonly steps: number;
  /** A card's own extent, by its key, once somebody widened it. */
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
    // A unit only the baseline has belongs where it stood: the TOC unit the
    // current text has at that point — the one it ended, not the next.
    const anchor = unit.current?.from ?? Math.max(0, unit.place.current - 1);
    const at = Math.max(0, unitIndexAt(current, anchor));
    const held = groups.get(at);
    if (held === undefined) groups.set(at, [unit]);
    else held.push(unit);
  }

  const count = options.units.length;
  /** The first unit whose place in the current text is at or after `at`. */
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
    const key = `${options.bookId} ${addressCode(unitAddress(options.bookId, currentToc, toc))}`;
    const extent = options.extentOf?.(key) ?? { up: options.steps, down: options.steps };
    const shownCurrent = stretchOf(current, at, at, extent);
    // The baseline's stretch: the units its own changes span there, widened
    // the same way. A card whose every change is new has none.
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
    // A unit the current text lacks, placed exactly at the stretch's end, is
    // the one the last shown unit ENDED — grouped with it above, so painted
    // with it too.
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
      reference: own[0] === undefined ? "" : unitReference(own[0]),
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

/** Roughly one line of the scripture serif per this many characters of source. */
const CHARS_PER_LINE = 70;

/** A card's height before it has been measured. */
export const estimate = (hunk: Hunk): number =>
  60 + Math.ceil((hunk.current.to - hunk.current.from) / CHARS_PER_LINE) * 30;

/** The card's place: its own unit's reference ("1:4"). */
export const hunkLabel = (hunk: Hunk): string => hunk.reference;

/** A change whose words are the same on both sides: markup, or spacing. */
export const isFormatting = (unit: DecisionUnit): boolean =>
  unit.isWhitespaceChange || unit.isUsfmStructureChange;

/**
 * What KIND of change a card holds when that is not the words: the engine's
 * own classification. A card whose every change is one kind says so; a mixed
 * card says how many, since the rest are the words.
 */
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
