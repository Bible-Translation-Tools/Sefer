// skeleton.ts
//
// THE REVIEW DIFF: the engine's decision-unit diff, cached by the pair of texts
// it came from. One producer, no fallback.
//
// "The engine is the only diff": Sefer keeps no aligner of its own, not even a
// cold one, because a second implementation that nothing runs is a second
// implementation that rots and then gets switched on by accident.
//
// So this module is a CACHE and one call. The cache is not an optimisation
// detail: the review screen re-derives its units whenever the shell ticks, and
// an engine diff of two whole books per tick is exactly the cold path a
// translator feels. Keyed on each text's hash (`galley.hash`, xxh3), so there
// is nothing to invalidate — a text that has changed is a different key — and
// the key is a few dozen characters rather than both whole books glued into
// one new string on every call. The entry keeps the two texts it was made of
// (the same strings, not copies) and a hit is confirmed against them, so a
// hash collision can never hand back another text's diff.
//
// Both doors answer `Result`, and the failure is `EngineDoorMissing`. That is
// not hedging: the doors are free functions probed by name off the wasm module,
// so an artifact that is not the pinned build is a real failure mode, and the
// screen must say "this build's engine has no diff" rather than draw something
// it made up.

import { Result } from "effect";

import type { DiffSkeleton, EngineDoorMissing, GalleyService } from "../galley";

/** What the screen holds: the diff, or the reason there is none. */
export type SkeletonResult = Result.Result<DiffSkeleton, EngineDoorMissing>;

const CACHE_LIMIT = 4;
interface Held {
  readonly baselineText: string;
  readonly currentText: string;
  readonly skeleton: SkeletonResult;
}
const cache = new Map<string, Held>();

const remember = (key: string, held: Held): SkeletonResult => {
  cache.set(key, held);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return held.skeleton;
};

/**
 * THE ONE DOOR the screen calls.
 *
 * `book` is not needed to render the sids — the engine reads the `\id` line
 * itself — but it is in the cache key, because two different books can hold
 * identical text (an empty file, a stub) and must not share a diff.
 */
export const diffSkeleton = (
  galley: GalleyService,
  book: string,
  baselineText: string,
  currentText: string,
): SkeletonResult => {
  const key = `${book} ${galley.hash(baselineText)}:${baselineText.length} ${galley.hash(currentText)}:${currentText.length}`;
  const held = cache.get(key);
  if (held !== undefined && held.baselineText === baselineText && held.currentText === currentText)
    return held.skeleton;
  return remember(key, {
    baselineText,
    currentText,
    skeleton: galley.diff(baselineText, currentText),
  });
};
