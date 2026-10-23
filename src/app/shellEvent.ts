import type { BookId } from "@sefer/text/book";

export type ShellEvent =
  | { readonly kind: "book.apply"; readonly books: readonly BookId[] }
  | { readonly kind: "book.write"; readonly books: readonly BookId[]; readonly recorded: boolean }
  | { readonly kind: "journal.restore"; readonly books: readonly BookId[] }
  | { readonly kind: "project.open" }
  | { readonly kind: "corpus.publish" }
  | { readonly kind: "corpus.rejudge" }
  | { readonly kind: "findings.suppress" }
  | { readonly kind: "seat.open"; readonly books: readonly BookId[] }
  | { readonly kind: "seat.close"; readonly books: readonly BookId[] };

export const booksOf = (event: ShellEvent): readonly BookId[] | "all" => {
  switch (event.kind) {
    case "book.apply":
    case "book.write":
    case "journal.restore":
    case "seat.open":
    case "seat.close":
      return event.books;
    case "project.open":
      return "all";
    case "corpus.publish":
    case "corpus.rejudge":
    case "findings.suppress":
      return [];
  }
};
