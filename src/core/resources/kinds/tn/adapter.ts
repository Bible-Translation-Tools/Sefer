import type { BookId } from "@sefer/text/book";
import type { Address } from "@sefer/text/location/address";
import { Effect, Option, type FileSystem } from "effect";

import {
  Unavailable,
  type HaystackDocument,
  type PlaceContext,
  type ResourceHandle,
} from "../handle";
import { FolderTree } from "../tree";
import { answersPlace, noteOf, type Note } from "./note";
import { bookPack, helpBooks, type HelpBook, type Pack } from "./pack";

const HELD = 3;

export const openTranslationNotes = (
  fileSystem: FileSystem.FileSystem,
  resource: { readonly root: string; readonly title: string; readonly language?: string },
): Effect.Effect<ResourceHandle<Note>, Unavailable> =>
  Effect.gen(function* () {
    const books = new Map<string, HelpBook>(
      (yield* helpBooks(fileSystem, resource.root)).map((help) => [help.book, help]),
    );
    const fast = yield* Effect.serviceOption(FolderTree);
    const withHost = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Option.isSome(fast) ? Effect.provideService(effect, FolderTree, fast.value) : effect;
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
        const pack = yield* withHost(bookPack(fileSystem, resource.root, help));
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

    const haystack = new Map<string, readonly HaystackDocument[]>();
    const list = (requested: readonly BookId[], context?: PlaceContext) =>
      Effect.gen(function* () {
        const documents: HaystackDocument[] = [];
        for (const book of requested) {
          const id = book.toUpperCase();
          if (!books.has(id)) continue;
          const kept = haystack.get(id);
          if (kept !== undefined) {
            documents.push(...kept);
            continue;
          }
          const pack = yield* packOf(book);
          const made = pack.notes.map((record, index): HaystackDocument => {
            const note = noteOf(book, record, context);
            return {
              id: `${pack.book}#${index}`,
              text: `${note.heading ?? ""}${note.body}`,
              addresses: [note.address],
            };
          });
          haystack.set(id, made);
          documents.push(...made);
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
      release: Effect.sync(() => {
        held.clear();
        haystack.clear();
      }),
    };
  });
