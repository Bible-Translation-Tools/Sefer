import type { NameTable } from "@wycliffeassociates/scripture-kitchen/canon";
import {
  Citations,
  showReference,
  type Citation as GalleyCitation,
} from "@wycliffeassociates/scripture-kitchen/web";
import type { BookId } from "@wycliffeassociates/sefer-text/book";
import type { Address } from "@wycliffeassociates/sefer-text/location/address";
import { createMemo, type Accessor } from "solid-js";

import { m } from "#app/paraglide/messages";
import { stampMatches, type Analysis, type EngineStamp } from "#core/galley";
import type { Project } from "#core/project/project";

import { canonNames } from "./canonNames";
import { uiLocale } from "./locale";
import { bookName } from "./ui/workspace/books";
import { metadataOf } from "./ui/workspace/project";

/** What a person typed, read: galley's `Citation`, its addresses Sefer's `Address`. */
export type Citation = GalleyCitation;

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

/** Every name a reader of this project might type for `id`: the project's own, then canon's. */
const namesFor = (
  id: string,
  own: Readonly<Record<string, string>> | undefined,
  tables: readonly NameTable[],
): string[] => {
  const names = Object.values(own ?? {}).filter((each) => each !== "");
  for (const table of tables)
    for (const each of table.books[id] ?? []) if (each !== "") names.push(each);
  return names;
};

export const createLocation = (project: Accessor<Project | undefined>): Location => {
  const held = createMemo(
    () => new Set((project()?.books ?? []).map((book) => book.id.toUpperCase())),
    { name: "heldBooks" },
  );
  const heldList = createMemo(() => [...held()], { name: "heldBookList" });
  const citations = createMemo(
    (): Citations => {
      const open = project();
      const metadata = metadataOf(open);
      const tables = canonNames(uiLocale());
      const ids = new Set([
        ...Object.keys(metadata?.bookNames ?? {}),
        ...(open?.books.map((book) => book.id) ?? []),
        ...tables.flatMap((table) => Object.keys(table.books)),
      ]);
      const names: Record<string, string[]> = {};
      for (const id of ids) {
        const list = namesFor(id, metadata?.bookNames[id], tables);
        if (list.length > 0) names[id] = list;
      }
      return new Citations({
        names,
        // Every held book, so a peripheral (FRT) or one outside canon still matches.
        books: (open?.books ?? []).map((book) => book.id),
        intro: [m.common_intro()],
      });
    },
    { name: "citations" },
  );

  return {
    read: (text) => citations().read(text, { grammar: "navigation", held: heldList() }),
    books: (text) => citations().booksMatching(text),
    holds: (book) => held().has(book.toUpperCase()),
    label: (address, heading) =>
      showReference(
        address,
        bookName(address.book, metadataOf(project()), heading),
        m.common_intro(),
      ),
    addressAt: (book, offset, measured, analysis) => {
      if (analysis === undefined || !stampMatches(measured, analysis)) return undefined;
      return analysis.addressAt(book, offset);
    },
  };
};
