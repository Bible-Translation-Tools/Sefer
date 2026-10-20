import type { EditorBook } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import { createEffect, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";

export interface SeatsOptions {
  readonly wanted: () => BookId | undefined;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly analysisOf: (bookId: BookId, side: "current" | "baseline", text: string) => Analysis;
}

export interface LiveHandle {
  readonly book: EditorBook;
  readonly analyze: (text: string) => Analysis;
}

export function createSeats(options: SeatsOptions): (bookId: BookId) => LiveHandle | undefined {
  const { analysisOf } = options;
  const [seats, setSeats] = createSignal<ReadonlyMap<BookId, EditorBook>>(new Map(), {
    name: "reviewSeats",
  });
  createEffect(
    () => {
      const bookId = options.wanted();
      return bookId === undefined ? [] : [bookId];
    },
    (bookIds) => {
      if (bookIds.length === 0) return;
      let current = true;
      for (const bookId of bookIds) {
        if (untrack(seats).has(bookId)) continue;
        void options.seat(bookId).then((book) => {
          if (!current || book === undefined) return;
          setSeats((held) =>
            held.get(bookId) === book ? held : new Map([...held, [bookId, book]]),
          );
        });
      }
      return () => {
        current = false;
      };
    },
  );

  const handles = new WeakMap<EditorBook, LiveHandle>();
  return (bookId: BookId) => {
    const book = seats().get(bookId);
    if (book === undefined) return undefined;
    let handle = handles.get(book);
    if (handle === undefined) {
      handle = { book, analyze: (text: string) => analysisOf(bookId, "current", text) };
      handles.set(book, handle);
    }
    return handle;
  };
}
