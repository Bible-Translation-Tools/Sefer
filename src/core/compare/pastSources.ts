import type { Book, BookId } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";
import { Effect, Option } from "effect";

import type { Project } from "../project/project";
import { failCompare, type CompareSource } from "./source";

export interface SavedText {
  readonly text: string;
  readonly stamp: SourceStamp;
}

export const savedSource = (
  project: Project,
  baselineOf: (book: Book) => Option.Option<SavedText>,
  label = "The file on disk",
): CompareSource => ({
  id: `disk:${project.id}`,
  label,
  kind: "disk",
  canApply: false,

  books: () => Effect.sync(() => project.books.map((book) => book.id)),

  read: (bookId) =>
    Effect.suspend(() => {
      const book = project.book(bookId);
      if (book === undefined)
        return failCompare("Absent", `${bookId} is not a book in ${project.root}`);
      const baseline = baselineOf(book);
      if (Option.isSome(baseline))
        return Effect.succeed({ text: baseline.value.text, stamp: baseline.value.stamp });
      const source = book.source();
      return Effect.succeed({ text: source.text, stamp: source.stamp });
    }),
});

export interface RecordedTexts {
  readonly head: string | undefined;
  readonly texts: ReadonlyMap<BookId, SavedText>;
}

export const recordedSource = (
  recorded: RecordedTexts,
  label = "The last recorded version",
): CompareSource => ({
  id: `recorded:${recorded.head ?? "none"}`,
  label: recorded.head === undefined ? `${label} (nothing recorded yet)` : label,
  kind: "recorded",
  canApply: false,

  books: () => Effect.sync(() => [...recorded.texts.keys()]),

  read: (bookId) =>
    Effect.suspend(() => {
      const held = recorded.texts.get(bookId);
      return held === undefined
        ? failCompare("Absent", `${bookId} is not in the last recorded version`)
        : Effect.succeed({ text: held.text, stamp: held.stamp });
    }),
});

export const sharedSource = (
  shared: RecordedTexts,
  label = "The shared project",
): CompareSource => ({
  id: `remote:${shared.head ?? "none"}`,
  label: shared.head === undefined ? `${label} (nothing checked yet)` : label,
  kind: "remote",
  canApply: false,

  books: () => Effect.sync(() => [...shared.texts.keys()]),

  read: (bookId) =>
    Effect.suspend(() => {
      const held = shared.texts.get(bookId);
      return held === undefined
        ? failCompare("Absent", `${bookId} is not in the shared project`)
        : Effect.succeed({ text: held.text, stamp: held.stamp });
    }),
});
