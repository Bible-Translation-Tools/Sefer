import type { EngineRange, GalleyService, MaskMap } from "#core/galley";

const LIMIT = 4;
type Recipe = "text" | "verseText";
const caches: Record<Recipe, Map<string, MaskMap | undefined>> = {
  text: new Map(),
  verseText: new Map(),
};

const maskOf = (galley: GalleyService, text: string, recipe: Recipe): MaskMap | undefined => {
  if (text === "") return undefined;
  const cache = caches[recipe];
  if (cache.has(text)) return cache.get(text);
  const held = galley.readerMask(text, recipe);
  cache.set(text, held);
  while (cache.size > LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return held;
};

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
    const row = mask.range(n);
    const start = row.sourceFrom;
    const end = row.sourceTo;
    if (start >= to) break;
    out += text.slice(Math.max(start, from), Math.min(end, to));
  }
  return out;
};

export const textOf = (
  galley: GalleyService,
  text: string,
  range: EngineRange | undefined,
  markup: boolean,
): string | undefined => {
  if (range === undefined) return undefined;
  const raw = text.slice(range.from, range.to);
  if (markup) return raw;
  const mask = maskOf(galley, text, "text");
  if (mask === undefined) return raw;
  return cut(mask, text, range.from, range.to);
};

export const verseTextOf = (galley: GalleyService, text: string, range: EngineRange): string => {
  const mask = maskOf(galley, text, "verseText");
  if (mask === undefined) return text.slice(range.from, range.to);
  return cut(mask, text, range.from, range.to);
};
