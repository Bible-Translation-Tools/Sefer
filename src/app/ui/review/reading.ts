/**
 * A unit's text, in whichever of the two readings the header's toggle asks for.
 *
 * There are exactly two, and the toggle between them is one of the decisions
 * this screen exists to honour ("a toggle to show USFM markup or projected text
 * in the diff"):
 *
 *   * the SOURCE — the exact USFM of the unit's span. This is what a reviewer
 *     needs when the change IS the markup, and it is the only reading in which
 *     `\p` becoming `\m` is visible at all.
 *   * the READING — the engine's reader text (`GalleyService.readerMask`, the
 *     `"text"` recipe) cut to the unit's span: every text character, note prose
 *     included, markers not. This is the sentence a translator is actually
 *     deciding about, and it is the default, because a review that shows
 *     markers first makes the reader do the projection in their head.
 *
 * The reading is the ENGINE's, and it is the same cut its diff runs are in:
 * a changed unit's non-markup runs concatenate to exactly this string
 * (`readingRuns` in `core/galley/diff.ts`). So a row with runs and a row
 * without read the same way, and a footnote shows in both or in neither —
 * which is why Sefer asks rather than projecting the span itself.
 *
 * The masks are cached BY TEXT, small and bounded. The review re-derives its
 * units whenever the shell ticks, and a tick would otherwise cost one mask per
 * side per render.
 */

import type { EngineRange, GalleyService, MaskMap } from "#core/galley";

/** Two sides of one book, plus room to switch books without re-masking. */
const LIMIT = 4;
const cache = new Map<string, MaskMap | undefined>();

/**
 * One mask, remembered by the text itself — so there is nothing to
 * invalidate: a text that has changed is a different key.
 *
 * A text the engine refuses caches as `undefined` rather than asking again on
 * every render. The caller falls back to the raw slice, which is still a true
 * reading of the bytes.
 */
const maskOf = (galley: GalleyService, text: string): MaskMap | undefined => {
  if (text === "") return undefined;
  if (cache.has(text)) return cache.get(text);
  const held = galley.readerMask(text);
  cache.set(text, held);
  while (cache.size > LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return held;
};

/**
 * The kept characters of `[from, to)`: the mask's ranges, clipped to the span.
 *
 * Pure arithmetic over what the engine answered. The mask's ranges are sorted
 * and disjoint, so the first one reaching past `from` is a binary search and
 * the rest are read in order until one starts at or past `to`.
 */
const cut = (mask: MaskMap, text: string, from: number, to: number): string => {
  let low = 0;
  let high = mask.rangeCount;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (mask.range(mid).sourceTo <= from) low = mid + 1;
    else high = mid;
  }
  let out = "";
  for (let n = low; n < mask.rangeCount; n += 1) {
    // Both ends are read before the cursor moves again.
    const row = mask.range(n);
    const start = row.sourceFrom;
    const end = row.sourceTo;
    if (start >= to) break;
    out += text.slice(Math.max(start, from), Math.min(end, to));
  }
  return out;
};

/**
 * The unit's text on one side.
 *
 * `undefined` for the absent side of a one-sided unit — which the card renders
 * as "Nothing on this side" rather than as an empty string, because "the verse
 * is not here" and "the verse is empty" are different facts.
 */
export const textOf = (
  galley: GalleyService,
  text: string,
  range: EngineRange | undefined,
  markup: boolean,
): string | undefined => {
  if (range === undefined) return undefined;
  const raw = text.slice(range.from, range.to);
  if (markup) return raw;
  const mask = maskOf(galley, text);
  if (mask === undefined) return raw;
  return cut(mask, text, range.from, range.to);
};
