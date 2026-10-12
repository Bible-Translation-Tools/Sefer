/**
 * Translation Notes as a `ResourceHandle`: the TN kind's adapter.
 *
 * In core because it imports nothing but the `FileSystem` port and the pure
 * reader; a kind that loads wasm or fetches (Macula) has its adapter under
 * `src/platform` instead, and the kind table in `src/app` maps both.
 *
 * Holds a few books' packs in memory — the one being read and the ones just
 * before it — and loads the next on demand; a Bible's notes are 14 MB of
 * text, and nothing reads them all at once except a search, which asks book
 * by book.
 */

import { Effect, type FileSystem } from "effect";

import type { BookId } from "../../../book/book";
import type { Address } from "../../../location/address";
import {
  Unavailable,
  type HaystackDocument,
  type PlaceContext,
  type ResourceHandle,
} from "../handle";
import { answersPlace, noteOf, type Note } from "./note";
import { bookPack, helpBooks, type HelpBook, type Pack } from "./pack";

/** How many books' packs stay in memory. A reader moves between two or three. */
const HELD = 3;

export const openTranslationNotes = (
  fileSystem: FileSystem.FileSystem,
  resource: { readonly root: string; readonly title: string; readonly language?: string },
): Effect.Effect<ResourceHandle<Note>, Unavailable> =>
  Effect.gen(function* () {
    const books = new Map<string, HelpBook>(
      (yield* helpBooks(fileSystem, resource.root)).map((help) => [help.book, help]),
    );
    /** Most recent last. */
    const held = new Map<string, Pack>();

    const packOf = (book: BookId): Effect.Effect<Pack, Unavailable> =>
      Effect.gen(function* () {
        const id = book.toUpperCase();
        const cached = held.get(id);
        if (cached !== undefined) {
          held.delete(id);
          held.set(id, cached);
          return cached;
        }
        const help = books.get(id);
        if (help === undefined)
          return yield* Effect.fail(
            new Unavailable({ reason: "Missing", description: `${resource.title} has no ${id}` }),
          );
        const pack = yield* bookPack(fileSystem, resource.root, help);
        held.set(id, pack);
        for (const oldest of held.keys()) {
          if (held.size <= HELD) break;
          held.delete(oldest);
        }
        return pack;
      });

    const at = (address: Address, context?: PlaceContext) =>
      Effect.map(packOf(address.book), (pack): readonly Note[] =>
        pack.notes
          .filter((record) => answersPlace(record.span, address))
          .map((record) => noteOf(address.book, record, context)),
      );

    const list = (requested: readonly BookId[], context?: PlaceContext) =>
      Effect.gen(function* () {
        const documents: HaystackDocument[] = [];
        for (const book of requested) {
          if (!books.has(book.toUpperCase())) continue;
          const pack = yield* packOf(book);
          pack.notes.forEach((record, index) => {
            const note = noteOf(book, record, context);
            documents.push({
              id: `${pack.book}#${index}`,
              text: `${note.heading ?? ""}${note.body}`,
              addresses: [note.address],
            });
          });
        }
        return documents;
      });

    return {
      info: {
        content: "tn",
        title: resource.title,
        ...(resource.language === undefined ? {} : { language: resource.language }),
        direction: "ltr",
      },
      places: { at, of: (note) => [note.address] },
      documents: { list },
      release: Effect.sync(() => held.clear()),
    };
  });
