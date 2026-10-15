/**
 * Expect: an assertion about aligned results.
 *
 * Find answers "where does this text say A?". Alignment answers "and what
 * does the other text say there?", verse by verse. Expect is the third step:
 * "where the reference says A, MY text should say B", and it splits the
 * aligned verses into those that do and those that do not.
 *
 * The second list is the work. Where the source says "Jesus" and a Bisa
 * translation expects "Yesu", the verses without "Yesu" are where the
 * translator wrote "Yessu", "Ysu" or "Yesa", or rendered the name another way
 * on purpose. No spelling list, no dictionary of the target language and no
 * model is needed: the reference supplies the places, the person supplies
 * the one word they expect, and the text answers. The same assertion works
 * for any term with a settled rendering (a key term, a place name, a divine
 * name), in any script.
 *
 * Pure: a pattern, one book's text and the verses to check. Find uses it over
 * a reference search; Key terms could use it over a guide's verses.
 */

import type { Address } from "@sefer/text/location/address";
import { resolve } from "@sefer/text/location/locate";

import type { BookText, Occurrence } from "../excerpts/excerpts";
import { tocViewOf } from "../galley";

/**
 * The expected rendering as typed, as a pattern, or undefined when nothing
 * usable was typed.
 *
 * - `Yesu`: those letters touching, in any case.
 * - `a + n + g`: a, then n, then g, later in the same word, with any letters
 *   or marks between (an inserted vowel, Arabic-style harakat).
 * - `/…/`: a regular expression, as written.
 */
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
    // Each typed piece is its own group, so only the typed letters are
    // highlighted and not the letters between them.
    return new RegExp(pieces.map((piece) => `(${piece})`).join("[\\p{L}\\p{M}]*?"), "diu");
  } catch {
    return undefined;
  }
};

/** The checked verses of one book: with the expected rendering, and without. */
export interface Expectation {
  /** The match in each verse that has it, its typed pieces marked. */
  readonly has: readonly Occurrence[];
  /** A zero-width occurrence at the start of each verse that does not. */
  readonly missing: readonly Occurrence[];
}

/**
 * Checks each verse of `addresses` that this book holds for `pattern`.
 *
 * A verse is read as written, markup included, so a rendering inside a
 * footnote counts; one verse holding a misspelling AND the right spelling has
 * it. Two addresses on one verse (both verses of a bridge) are checked once.
 * An address this book does not hold is skipped, as `refOccurrences` skips it.
 */
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
