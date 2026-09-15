/**
 * A unit's text, in whichever of the two readings the header's toggle asks for.
 *
 * There are exactly two, and the toggle between them is one of the decisions
 * this screen exists to honour (Will, 2026-09-15: "a toggle to show USFM markup
 * or projected text in the diff"):
 *
 *   * the SOURCE — the exact USFM bytes of the unit's span. This is what a
 *     reviewer needs when the change IS the markup, and it is the only reading
 *     in which `\p` becoming `\m` is visible at all.
 *   * the READING — `core/excerpts`' `project`: text tokens, note bodies
 *     dropped, runs of whitespace collapsed to one space. This is the sentence
 *     a translator is actually deciding about, and it is the default, because
 *     a review that shows markers first makes the reader do the projection in
 *     their head.
 *
 * Both come from the same `Analysis`, so a unit whose two readings are equal
 * and whose two sources are not is a markup-only change — which is the badge,
 * and which `core/diff/skeleton.ts` computes the same way for exactly the same
 * reason.
 *
 * The analyses are cached BY TEXT, small and bounded. The review re-derives its
 * units whenever the shell ticks, and a tick would otherwise cost one whole
 * book parse per side per render.
 */

import { project } from "../../../core/excerpts/excerpts";
import type { Analysis, EngineRange, GalleyService } from "../../../core/galley";

/** Two sides of one book, plus room to switch books without re-parsing. */
const LIMIT = 4;
const cache = new Map<string, Analysis | undefined>();

/**
 * One parse, remembered by the text itself — so there is nothing to
 * invalidate: a text that has changed is a different key.
 *
 * A text the engine refuses (a stray carriage return the port should have
 * caught, a decode that went wrong) caches as `undefined` rather than throwing
 * on every render. The caller falls back to the raw slice, which is still a
 * true reading of the bytes.
 */
export const analysisOf = (galley: GalleyService, text: string): Analysis | undefined => {
  if (text === "") return undefined;
  if (cache.has(text)) return cache.get(text);
  let held: Analysis | undefined;
  try {
    held = galley.analyze(text);
  } catch {
    held = undefined;
  }
  cache.set(text, held);
  while (cache.size > LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return held;
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
  const analysis = analysisOf(galley, text);
  if (analysis === undefined) return raw;
  return project(analysis, range.from, range.to).text;
};
