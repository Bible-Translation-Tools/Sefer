import type { BookId } from "@wycliffeassociates/sefer-text/book";
import { addressLabel, type Address } from "@wycliffeassociates/sefer-text/location/address";
import {
  citationWords,
  parseCitation,
  type Citation,
} from "@wycliffeassociates/sefer-text/location/citation";
import { addressAt } from "@wycliffeassociates/sefer-text/location/locate";
import {
  booksMatching,
  nameCatalogue,
  type NameCatalogue,
} from "@wycliffeassociates/sefer-text/location/names";
import { createMemo, type Accessor } from "solid-js";

import { m } from "#app/paraglide/messages";
import { stampMatches, tocViewOf, type Analysis, type EngineStamp } from "#core/galley";
import type { Project } from "#core/project/project";

import { bookName } from "./ui/workspace/books";
import { metadataOf } from "./ui/workspace/project";

export interface Location {
  readonly read: (text: string) => Citation;
  readonly books: (text: string) => readonly BookId[];
  readonly holds: (book: BookId) => boolean;
  readonly label: (address: Address, heading?: string) => string;
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
        named: (id) => Object.values(metadata?.bookNames[id] ?? {}).filter((name) => name !== ""),
        extraIds: open?.books.map((book) => book.id) ?? [],
        intro: [m.common_intro()],
      });
    },
    { name: "nameCatalogue" },
  );

  return {
    read: (text) => parseCitation(text, catalogue(), { grammar: "navigation", held: held() }),
    books: (text) => booksMatching(citationWords(text), catalogue()),
    holds: (book) => held().has(book.toUpperCase()),
    label: (address, heading) =>
      addressLabel(
        address,
        bookName(address.book, metadataOf(project()), heading),
        m.common_intro(),
      ),
    addressAt: (book, offset, measured, analysis) => {
      if (analysis === undefined || !stampMatches(measured, analysis)) return undefined;
      return addressAt(book, tocViewOf(analysis), offset);
    },
  };
};
