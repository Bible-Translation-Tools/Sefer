/**
 * What Sefer calls a book. The book table itself is canon's (the kitchen's
 * `./canon`: order, codes, divisions, names); this is the policy over it.
 */
import { book, name } from "@wycliffeassociates/scripture-kitchen/canon";

import { localized, type LocalizedText } from "../localized";

/**
 * What a project says its books are called: the slice of the app's
 * `ProjectMetadata` that naming a book reads, so this package needs no project
 * model of its own. `ProjectMetadata` satisfies it as it stands.
 */
export interface BookNames {
  readonly bookNames: Readonly<Record<string, LocalizedText>>;
  readonly defaultLocale?: string | undefined;
  /** The project's language: its name for a book comes before the default locale's (a Burrito's is `en`). */
  readonly language?: { readonly tag: string } | undefined;
}

export type Testament = "ot" | "nt";

/**
 * Which testament a book belongs to. An id the canon does not know is `nt`,
 * so an unrecognised book lands at the end of a grouped list rather than in
 * the middle of the Pentateuch.
 */
export const testamentOf = (id: string): Testament =>
  book(id.toUpperCase())?.division === "ot" ? "ot" : "nt";

/**
 * What to call a book: what the project calls it (in the project's language
 * first, then its default locale), else what the book calls
 * itself (`heading` — its `\h` or `\toc2`, as the engine reads them, when the
 * caller holds a parse), else canon's English name (any book in canon's table,
 * peripheral ones included), else the id itself. Native
 * first, English second; never blank — the id is always something a reader
 * can act on.
 */
export const bookName = (id: string, metadata?: BookNames, heading?: string): string => {
  // Manifests key books by their code in capitals; a file's `\id` may be written in lower case.
  const names = metadata?.bookNames[id] ?? metadata?.bookNames[id.toUpperCase()];
  const local = localized(names, [metadata?.language?.tag, metadata?.defaultLocale]);
  if (local !== "") return local;
  if (heading !== undefined && heading !== "") return heading;
  return name(id.toUpperCase(), "short")?.text ?? id;
};
