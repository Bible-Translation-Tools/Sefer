// skeleton.ts
//
// THE REVIEW DIFF: the engine's decision-unit diff, cached by the pair of texts
// it came from. One producer, no fallback.
//
// "The engine is the only diff": Sefer keeps no aligner of its own, not even a
// cold one, because a second implementation that nothing runs is a second
// implementation that rots and then gets switched on by accident.
//
// So this module is a CACHE and two calls. The cache is not an optimisation
// detail: the review screen re-derives its units whenever the shell ticks, and
// an engine diff of two whole books per tick is exactly the cold path a
// translator feels. Keyed on the texts themselves, so there is nothing to
// invalidate — a text that has changed is a different key.
//
// Both doors answer `Result`, and the failure is `EngineDoorMissing`. That is
// not hedging: the doors are free functions probed by name off the wasm module,
// so an artifact that is not the pinned build is a real failure mode, and the
// screen must say "this build's engine has no diff" rather than draw something
// it made up.

import { Result } from "effect";

import type {
  DecisionMap,
  DiffSkeleton,
  EngineDoorMissing,
  GalleyService,
  MergeSide,
} from "../galley";

/** What the screen holds: the diff, or the reason there is none. */
export type SkeletonResult = Result.Result<DiffSkeleton, EngineDoorMissing>;

const CACHE_LIMIT = 4;
const cache = new Map<string, SkeletonResult>();

const remember = (key: string, skeleton: SkeletonResult): SkeletonResult => {
  cache.set(key, skeleton);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return skeleton;
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
  const key = `${book} ${baselineText} ${currentText}`;
  const held = cache.get(key);
  if (held !== undefined) return held;
  return remember(key, galley.diff(baselineText, currentText));
};

/**
 * One book's text under a decision map.
 *
 * The engine walks its own interleave, which is what makes a moved or coalesced
 * unit land where it belongs — the reason Sefer never tried to do this by
 * concatenating the chosen side of each unit in reading order, which is right
 * for the ordinary case and wrong for exactly the cases the decision unit
 * exists to describe.
 *
 * `fallback` is what an UNDECIDED unit takes. It is required, because "what
 * happens to the units nobody chose" is the whole safety question of a merge
 * and a default here would be Sefer answering it quietly for the caller.
 */
export const mergeWithDecisions = (
  galley: GalleyService,
  baselineText: string,
  currentText: string,
  decisions: DecisionMap,
  fallback: MergeSide,
): Result.Result<string, EngineDoorMissing> =>
  galley.merge(baselineText, currentText, decisions, fallback);
