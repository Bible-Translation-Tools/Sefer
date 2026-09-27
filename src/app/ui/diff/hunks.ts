/**
 * Changes as cards: each changed decision unit with its context, and
 * neighbours whose context would overlap joined into one card, so no verse is
 * shown twice.
 *
 * Context is TOC steps either side, like every excerpt (`core/location`): a
 * verse, a heading, a chapter's head. Spans are into each side's own
 * document, so a card clips each text to its own stretch and the diff view
 * paints on it.
 */

import { tocViewOf, type Analysis } from "#core/galley";
import { unitReference, type DecisionUnit } from "#core/galley/diff";
import { tocUnits, unitIndexAt } from "#core/location/locate";

import { changed } from "./paint";

export interface Range {
  readonly from: number;
  readonly to: number;
}

/** One card: the changes it holds, and the stretch of each text it shows. */
export interface Hunk {
  readonly bookId: string;
  /** Stable while the first change is: the list's row key. */
  readonly key: string;
  readonly units: readonly DecisionUnit[];
  /** What the current text shows, and where it stands before the first unit. */
  readonly current: Range;
  readonly currentStart: number;
  /** What the baseline text shows; absent when every unit here is current-only. */
  readonly baseline: Range | undefined;
  readonly baselineStart: number;
}

/** `[from, to)` widened by `steps` TOC units either side, in one text. */
const withContext = (analysis: Analysis, from: number, to: number, steps: number): Range => {
  const units = tocUnits(tocViewOf(analysis));
  const low = Math.max(0, unitIndexAt(units, from) - steps);
  const high = Math.min(units.length - 1, unitIndexAt(units, Math.max(from, to - 1)) + steps);
  return { from: units[low]?.from ?? from, to: units[high]?.to ?? to };
};

/**
 * One book's changed units as cards.
 *
 * `units` is the whole book in reading order (`ordered`), unchanged units
 * included: they are what tells a one-sided unit where it stands in the text
 * that lacks it. `include` narrows which changes get a card — the kind filter.
 */
export const hunksOf = (options: {
  readonly bookId: string;
  readonly units: readonly DecisionUnit[];
  readonly baseline: Analysis;
  readonly current: Analysis;
  readonly steps: number;
  readonly include?: (unit: DecisionUnit) => boolean;
}): Hunk[] => {
  const { baseline, current, steps } = options;
  const out: Hunk[] = [];
  let currentEnd = 0;
  let baselineEnd = 0;
  for (const unit of options.units) {
    const beforeCurrent = currentEnd;
    const beforeBaseline = baselineEnd;
    if (unit.current !== undefined) currentEnd = unit.current.to;
    if (unit.baseline !== undefined) baselineEnd = unit.baseline.to;
    if (!changed(unit) || options.include?.(unit) === false) continue;
    const here = unit.current ?? { from: beforeCurrent, to: beforeCurrent };
    const shown = withContext(current, here.from, Math.max(here.from + 1, here.to), steps);
    const was =
      unit.baseline === undefined
        ? undefined
        : withContext(baseline, unit.baseline.from, unit.baseline.to, steps);
    const last = out.at(-1);
    if (last !== undefined && shown.from <= last.current.to) {
      out[out.length - 1] = {
        ...last,
        units: [...last.units, unit],
        current: { from: last.current.from, to: Math.max(last.current.to, shown.to) },
        baseline:
          was === undefined
            ? last.baseline
            : last.baseline === undefined
              ? was
              : { from: last.baseline.from, to: Math.max(last.baseline.to, was.to) },
      };
      continue;
    }
    out.push({
      bookId: options.bookId,
      key: `${options.bookId} ${unit.id}`,
      units: [unit],
      current: shown,
      currentStart: beforeCurrent,
      baseline: was,
      baselineStart: beforeBaseline,
    });
  }
  return out;
};

/** Roughly one line of the scripture serif per this many characters of source. */
const CHARS_PER_LINE = 70;

/** A card's height before it has been measured. */
export const estimate = (hunk: Hunk): number =>
  60 + Math.ceil((hunk.current.to - hunk.current.from) / CHARS_PER_LINE) * 30;

/** "1:4", or "1:4 – 1:9" for a card holding several changes. */
export const hunkLabel = (hunk: Hunk): string => {
  const first = hunk.units[0];
  const last = hunk.units.at(-1);
  if (first === undefined || last === undefined) return "";
  return first === last ? unitReference(first) : `${unitReference(first)} – ${unitReference(last)}`;
};

/** A change whose words are the same on both sides: markup, or spacing. */
export const isFormatting = (unit: DecisionUnit): boolean =>
  unit.isWhitespaceChange || unit.isUsfmStructureChange;

/**
 * What KIND of change a card holds when that is not the words: the engine's
 * own classification. A card whose every change is one kind says so; a mixed
 * card says how many, since the rest are the words.
 */
export const hunkKind = (units: readonly DecisionUnit[]): string | undefined => {
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
