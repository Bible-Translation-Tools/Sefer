import { Result } from "effect";

import type { DiffSkeleton, EngineDoorMissing, GalleyService } from "../galley";

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

export const diffSkeleton = (
  galley: GalleyService,
  book: string,
  baselineText: string,
  currentText: string,
  options: { readonly unchanged?: boolean } = {},
): SkeletonResult => {
  const unchanged = options.unchanged === true;
  const key = `${book} ${unchanged ? "all" : "changed"} ${galley.hash(baselineText)}:${baselineText.length} ${galley.hash(currentText)}:${currentText.length}`;
  const held = cache.get(key);
  if (held !== undefined && held.baselineText === baselineText && held.currentText === currentText)
    return held.skeleton;
  return remember(key, {
    baselineText,
    currentText,
    skeleton: galley.diff(baselineText, currentText, { unchanged }),
  });
};
