import { isDesignatorLine, type Block, type DocStructure } from "./docStructure";

function lastVerseOpeningAtOrBefore(structure: DocStructure, pos: number): number {
  const verses = structure.verses;
  let lo = 0;
  let hi = verses.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (verses[mid].markerFrom <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function inDesignatorDelimiter(structure: DocStructure, pos: number): boolean {
  const k = lastVerseOpeningAtOrBefore(structure, pos);
  if (k >= 0) {
    const verse = structure.verses[k];
    if (verse.num !== null && pos >= verse.numTo && pos < verse.contentFrom) return true;
  }
  const i = structure.lines.indexAt(pos);
  if (i < 0) return false;
  const line = structure.lines.at(i);
  return isDesignatorLine(line) && line.num !== null && pos >= line.numTo && pos < line.contentFrom;
}

const DEFAULT_BLOCK = "p";

export const blockKindForEnter = (b: Block | null): string =>
  b && b.cls !== "block.heading" && b.cls !== "block.meta" ? b.kind : DEFAULT_BLOCK;

export const isInsignificantWhitespace = (inserted: string): boolean =>
  inserted.length <= 1 && /^\s*$/.test(inserted);
