import type { Address } from "@sefer/text/location/address";
import { resolve } from "@sefer/text/location/locate";

import type { BookText, Occurrence } from "../excerpts/excerpts";
import { tocViewOf } from "../galley";

export const expectedPattern = (typed: string): RegExp | undefined => {
  const text = typed.trim();
  if (text === "") return undefined;
  try {
    if (text.length > 2 && text.startsWith("/") && text.endsWith("/"))
      return new RegExp(text.slice(1, -1), "diu");
    const pieces = text
      .split("+")
      .map((piece) => piece.trim())
      .filter((piece) => piece !== "")
      .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
    if (pieces.length === 0) return undefined;
    return new RegExp(pieces.map((piece) => `(${piece})`).join("[\\p{L}\\p{M}]*?"), "diu");
  } catch {
    return undefined;
  }
};

export interface Expectation {
  readonly has: readonly Occurrence[];
  readonly missing: readonly Occurrence[];
}

export const expectIn = (
  book: BookText,
  addresses: readonly Address[],
  pattern: RegExp,
): Expectation => {
  const toc = tocViewOf(book.analysis);
  const seen = new Set<number>();
  const has: Occurrence[] = [];
  const missing: Occurrence[] = [];
  for (const address of addresses) {
    if (address.kind !== "verses" || address.book !== book.bookId) continue;
    const found = resolve(toc, address);
    if (found.kind !== "found" || seen.has(found.from)) continue;
    seen.add(found.from);
    const match = pattern.exec(book.text.slice(found.from, found.to));
    if (match === null) {
      missing.push({ bookId: book.bookId, from: found.from, to: found.from });
      continue;
    }
    const from = found.from + match.index;
    const pieces = (match.indices ?? [])
      .slice(1)
      .flatMap((span) =>
        span === undefined ? [] : [{ from: found.from + span[0], to: found.from + span[1] }],
      );
    has.push({
      bookId: book.bookId,
      from,
      to: from + match[0].length,
      ...(pieces.length > 1 ? { pieces } : {}),
    });
  }
  const byPlace = (left: Occurrence, right: Occurrence): number => left.from - right.from;
  return { has: has.toSorted(byPlace), missing: missing.toSorted(byPlace) };
};
