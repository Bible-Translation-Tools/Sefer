import { isDesignatorLine, type Block, type DocStructure } from "./docStructure";

function lastVerseOpeningAtOrBefore(s: DocStructure, pos: number): number {
  const verses = s.verses;
  let lo = 0;
  let hi = verses.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (verses[mid].markerFrom <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function inDesignatorDelimiter(s: DocStructure, pos: number): boolean {
  const k = lastVerseOpeningAtOrBefore(s, pos);
  if (k >= 0) {
    const v = s.verses[k];
    if (v.num !== null && pos >= v.numTo && pos < v.contentFrom) return true;
  }
  const i = s.lines.indexAt(pos);
  if (i < 0) return false;
  const l = s.lines.at(i);
  return isDesignatorLine(l) && l.num !== null && pos >= l.numTo && pos < l.contentFrom;
}

const DEFAULT_BLOCK = "p";

export const blockKindForEnter = (b: Block | null): string =>
  b && b.cls !== "block.heading" && b.cls !== "block.meta" ? b.kind : DEFAULT_BLOCK;

export const isInsignificantWhitespace = (inserted: string): boolean =>
  inserted.length <= 1 && /^\s*$/.test(inserted);
