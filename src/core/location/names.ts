/**
 * Which words mean which book: the name catalogue a Citation is read against.
 *
 * Passed in, never global. The words for a book are the canon's English name,
 * its id, whatever THIS PROJECT calls it (a translator on a Spanish project
 * types "Lucas", and `ProjectMetadata` knows that is `LUK` whether the project
 * declared itself in a Scripture Burrito or a Resource Container), and any
 * abbreviation somebody registered. The application builds one catalogue per
 * project, once per metadata change, and hands the same immutable value to
 * every parse; a result is consistent with the one catalogue it was read
 * against, which is what keeps a stale closure from mattering.
 *
 * NOT the books the project holds. "Romans" means `ROM` in a project without
 * Romans; a Citation of it is valid, and resolving it answers "missing". The
 * held set only breaks ties between prefixes, so "phil" in a project with
 * Philemon and no Philippians goes to the book that is there.
 */

import type { BookId } from "../book/book";
import { CANON } from "./canon";

export interface NameCatalogue {
  /** Every id the catalogue knows, canon order first, then the rest. */
  readonly ids: readonly BookId[];
  /** Every name for one id, folded, in the order they were supplied. */
  readonly names: (id: BookId) => readonly string[];
  /** Folded words that mean "the introduction": `intro`, a localized word. */
  readonly intro: readonly string[];
}

export interface CatalogueInput {
  /** What this project calls each book, in every locale it names one. */
  readonly named?: (id: BookId) => readonly string[];
  /** Ids outside the canon that should still be matchable (`FRT`, a `\z` book). */
  readonly extraIds?: readonly BookId[];
  /** Registered abbreviations per id: `Mt`, `Matt`. Exact matches only. */
  readonly abbreviations?: (id: BookId) => readonly string[];
  /** Words for the introduction, in the project's and the UI's languages. */
  readonly intro?: readonly string[];
}

/**
 * Case, accents and spacing folded away, so one typed word can match a name
 * written properly. NFKD splits a letter from its combining marks and the
 * marks are what we drop — "Éxodo" folds to "exodo" rather than to "xodo".
 * "1 Samuel" and "1Samuel" fold alike.
 */
export const fold = (text: string): string => {
  const squashed = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const numbered = /^(\d)\s*(.+)$/.exec(squashed);
  return numbered === null ? squashed : `${numbered[1] ?? ""} ${numbered[2] ?? ""}`;
};

const ENGLISH_INTRO = ["intro", "introduction"];

export const nameCatalogue = (input: CatalogueInput = {}): NameCatalogue => {
  const canonIds = CANON.map((book) => book.id);
  const extra = (input.extraIds ?? [])
    .map((id) => id.toUpperCase())
    .filter((id, at, all) => !canonIds.includes(id) && all.indexOf(id) === at);
  const ids = [...canonIds, ...extra];

  const english = new Map(CANON.map((book) => [book.id, book.name]));
  const table = new Map<BookId, readonly string[]>();
  for (const id of ids) {
    const words = [
      ...(input.named?.(id) ?? []),
      english.get(id),
      id,
      ...(input.abbreviations?.(id) ?? []),
    ]
      .filter((word): word is string => word !== undefined && word.trim() !== "")
      .map(fold);
    table.set(id, [...new Set(words)]);
  }

  return {
    ids,
    names: (id) => table.get(id.toUpperCase()) ?? [],
    intro: [...new Set([...(input.intro ?? []), ...ENGLISH_INTRO].map(fold))],
  };
};

/**
 * How strictly a book word must match.
 *
 * `prefix` is navigation's: somebody who typed four letters and pressed Enter
 * wants to arrive somewhere. `exact` is prose's: a word in a sentence is a
 * book only if it IS one of the book's names, ids or registered abbreviations.
 */
export type BookMatch = "exact" | "prefix";

/**
 * The book a word names, or `undefined`.
 *
 * Each step is tried across every book before the next, so an exact match
 * never loses to another book's prefix:
 *
 *   1. a name, id or abbreviation, exactly
 *   2. (prefix only) a name by prefix, held books first, each in canon order
 *   3. (prefix only) an id by prefix, the same way
 *
 * Canon order, not folder order, decides an ambiguous prefix: "phil" is
 * Philippians before Philemon.
 */
export const matchBook = (
  word: string,
  catalogue: NameCatalogue,
  match: BookMatch,
  held?: ReadonlySet<BookId>,
): BookId | undefined => {
  const wanted = fold(word);
  if (wanted === "") return undefined;

  const exact = catalogue.ids.find((id) => catalogue.names(id).includes(wanted));
  if (exact !== undefined || match === "exact") return exact;

  const order =
    held === undefined
      ? catalogue.ids
      : [
          ...catalogue.ids.filter((id) => held.has(id)),
          ...catalogue.ids.filter((id) => !held.has(id)),
        ];
  return (
    order.find((id) => catalogue.names(id).some((name) => name.startsWith(wanted))) ??
    order.find((id) => fold(id).startsWith(wanted))
  );
};

/** Does this word mean the introduction? */
export const isIntroWord = (word: string, catalogue: NameCatalogue): boolean =>
  catalogue.intro.includes(fold(word));
