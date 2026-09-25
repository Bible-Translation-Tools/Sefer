/**
 * The open project's answer to "where": the one place a screen asks what a
 * typed place means, what to call an Address, and which Address an offset of
 * a book is in.
 *
 * Policy and wiring only. The pieces that answer live in core — the Citation
 * parser (`core/location/citation`), Location over one text's TOC
 * (`core/location/locate`), and the engine's rows behind it
 * (`core/galley/location`). What this adds is the PROJECT: which words mean
 * which book here, which books it holds, and what a person reads for one.
 *
 * The name catalogue is a memo over the project and its metadata, so it is
 * built once per change of either rather than once per keystroke, and every
 * call reads it at the moment it is made; nothing captures one at setup and
 * goes stale.
 *
 * Not an Effect service: it is synchronous and scoped to one project, and the
 * shell's rule is that Effect is not a reason to make a service of a noun.
 */

import { createMemo, type Accessor } from "solid-js";

import type { BookId } from "#core/book/book";
import { stampMatches, tocViewOf, type Analysis, type EngineStamp } from "#core/galley";
import { addressLabel, type Address } from "#core/location/address";
import { citationWords, parseCitation, type Citation } from "#core/location/citation";
import { addressAt } from "#core/location/locate";
import { booksMatching, nameCatalogue, type NameCatalogue } from "#core/location/names";
import type { Project } from "#core/project/project";

import { t } from "./i18n";
import { bookName } from "./ui/workspace/books";
import { metadataOf } from "./ui/workspace/project";

export interface Location {
  /**
   * What somebody typed into a navigation box — the palette, the sidebar's
   * filter. Loose: a book prefix is enough, and "luk 3,1" is 3:1.
   */
  readonly read: (text: string) => Citation;
  /**
   * Every book the words of what was typed could mean, canon order — the
   * sidebar's filter, where `read` is the one book Enter would go to.
   */
  readonly books: (text: string) => readonly BookId[];
  /** Does this project hold the book an Address names? */
  readonly holds: (book: BookId) => boolean;
  /**
   * What a person reads: the project's own name for the book when it has
   * one, English otherwise — "Lucas 1:1-2" in a Spanish project.
   */
  readonly label: (address: Address) => string;
  /**
   * The Address at an offset of a book, from the analysis that offset was
   * measured against, or `undefined` when the analysis has moved on. A stale
   * address is worse than none: it names a verse the text may no longer be.
   */
  readonly addressAt: (
    book: BookId,
    offset: number,
    measured: EngineStamp,
    analysis: Analysis | undefined,
  ) => Address | undefined;
}

export const createLocation = (project: Accessor<Project | undefined>): Location => {
  const held = createMemo(
    () => new Set((project()?.books ?? []).map((book) => book.id.toUpperCase())),
    { name: "heldBooks" },
  );
  const catalogue = createMemo(
    (): NameCatalogue => {
      const open = project();
      const metadata = metadataOf(open);
      return nameCatalogue({
        // EVERY name the project publishes, not only the displayed one: a
        // project that names its books in two locales answers to both.
        named: (id) => Object.values(metadata?.bookNames[id] ?? {}).filter((name) => name !== ""),
        extraIds: open?.books.map((book) => book.id) ?? [],
        intro: [t("Intro")],
      });
    },
    { name: "nameCatalogue" },
  );

  return {
    read: (text) => parseCitation(text, catalogue(), { grammar: "navigation", held: held() }),
    books: (text) => booksMatching(citationWords(text), catalogue()),
    holds: (book) => held().has(book.toUpperCase()),
    label: (address) =>
      addressLabel(address, bookName(address.book, metadataOf(project())), t("Intro")),
    addressAt: (book, offset, measured, analysis) => {
      if (analysis === undefined || !stampMatches(measured, analysis)) return undefined;
      return addressAt(book, tocViewOf(analysis), offset);
    },
  };
};
