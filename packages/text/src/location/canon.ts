import { book, books, name } from "@wycliffeassociates/scripture-kitchen/canon";

import { localized, type LocalizedText } from "../localized";

/**
 * What a project says its books are called: the slice of the app's
 * `ProjectMetadata` that naming a book reads, so this package needs no project
 * model of its own. `ProjectMetadata` satisfies it as it stands.
 */
export interface BookNames {
  readonly bookNames: Readonly<Record<string, LocalizedText>>;
  readonly defaultLocale?: string | undefined;
}

export type Testament = "ot" | "nt";

export interface CanonicalBook {
  readonly id: string;
  readonly name: string;
  readonly testament: Testament;
}

/**
 * The 66 books in order, from canon's table (the kitchen's `./canon`). A
 * book's `name` is canon's short English name.
 */
export const CANON: readonly CanonicalBook[] = books("protestant66").map((row) => ({
  id: row.code,
  name: name(row.code, "short")?.text ?? row.english,
  testament: row.division === "ot" ? "ot" : "nt",
}));

/**
 * Which testament a book belongs to. An id the canon does not know is `nt`,
 * so an unrecognised book lands at the end of a grouped list rather than in
 * the middle of the Pentateuch.
 */
export const testamentOf = (id: string): Testament =>
  book(id.toUpperCase())?.division === "ot" ? "ot" : "nt";

/**
 * What to call a book: what the project calls it, else what the book calls
 * itself (`heading` — its `\h` or `\toc2`, as the engine reads them, when the
 * caller holds a parse), else canon's English name (any book in canon's table,
 * peripheral ones included), else the id itself. Native
 * first, English second; never blank — the id is always something a reader
 * can act on.
 */
export const bookName = (id: string, metadata?: BookNames, heading?: string): string => {
  const local = localized(metadata?.bookNames[id], [metadata?.defaultLocale]);
  if (local !== "") return local;
  if (heading !== undefined && heading !== "") return heading;
  return name(id.toUpperCase(), "short")?.text ?? id;
};
