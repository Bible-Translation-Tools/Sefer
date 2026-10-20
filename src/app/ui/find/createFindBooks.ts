import type { BookId } from "@sefer/text/book";
import { createSignal } from "solid-js";

import type { useShell } from "#app/ProjectContext";
import { scopeBooks, type BookScopeKind } from "#app/ui/primitives";
import type * as Search from "#core/search/search";

import type { Scope } from "./helpers";

export interface BooksInputs {
  readonly shell: ReturnType<typeof useShell>;
  readonly scope: () => Scope;
  readonly markup: () => boolean;
}

export function createFindBooks(inputs: BooksInputs) {
  const { shell, scope, markup } = inputs;
  const focusedBook = (): BookId | undefined => shell.focused()?.id;

  const [custom, setCustom] = createSignal<readonly BookId[]>([], { name: "findCustomBooks" });
  const projectBooks = (): readonly BookId[] => shell.project()?.books.map((book) => book.id) ?? [];
  const bookScope = (): BookScopeKind => {
    const held = scope();
    return held === "reference" || held === "helps" ? "project" : held;
  };

  const booksFor = (want: Scope): readonly BookId[] | undefined =>
    want === "reference" || want === "helps"
      ? undefined
      : scopeBooks(want, projectBooks(), focusedBook(), custom());
  const signature = (query: Search.Query, want: Scope): string =>
    JSON.stringify([
      want,
      booksFor(want),
      query.text,
      query.caseSensitive,
      query.wholeWord,
      query.regex,
      markup(),
    ]);

  return { focusedBook, custom, setCustom, projectBooks, bookScope, booksFor, signature };
}

export type FindBooks = ReturnType<typeof createFindBooks>;
