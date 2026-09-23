/**
 * What can change the UI, enumerated.
 *
 * The shell bridges a core that owns no signals (`pnpm boundaries`) to a Solid
 * tree that needs them. One counter meaning *something changed somewhere*
 * would make every derived read in the application recompute, and throw away
 * information that is always present — an accepted edit knows its Book, a
 * save knows which files it wrote.
 *
 * So this is that information, kept: a closed union of the events that can
 * move the project's derived state, each naming the Books it moved. Being
 * closed is the point: "what can change the UI" is a list you can read, and a
 * store can subscribe to the variants it actually cares about instead of to
 * all change everywhere.
 *
 * Named by the glossary's rule — `<thing>.<what happened to it>`, with the
 * thing a term from the table and the verb from the verb list
 * (documentation/glossary.md, "Observability names"). The names are therefore
 * already the names a trace uses, which is the other half of why the union is
 * worth having: a store update and a trace record become two renderings of
 * one event rather than two vocabularies for it.
 *
 * Deliberately narrow. A variant carries what a store READS today and nothing
 * else — there is no payload here designed for a store that does not exist
 * yet. Widen it when a store needs the field, not in anticipation.
 */

import type { BookId } from "#core/book/book";

export type ShellEvent =
  /** An edit was accepted into these Books: a keystroke, a fix, a format, a revert. */
  | { readonly kind: "book.apply"; readonly books: readonly BookId[] }
  /**
   * Disk bytes moved for these Books. `recorded` is whether a version holds
   * them — false is the failed-commit case, the one a reader is told about by
   * name (`saveState`'s `onDisk`).
   */
  | { readonly kind: "book.write"; readonly books: readonly BookId[]; readonly recorded: boolean }
  /** Recovery put journalled work back into these Books. */
  | { readonly kind: "journal.restore"; readonly books: readonly BookId[] }
  /** A project opened. Every book is new, so every book is news. */
  | { readonly kind: "project.open" }
  /**
   * A pull or a push finished. No book list: a transfer moves the repository
   * under the whole project, and which books it touched is git's answer, not
   * one we currently ask for.
   */
  | { readonly kind: "remote.transfer" }
  /** A Publication landed: new cross-book findings and a new census. */
  | { readonly kind: "corpus.publish" }
  /**
   * A Book was seated, or released back to a plain Book.
   *
   * Both matter because `instantiate` and `release` REPLACE the object that
   * holds the canonical text (`core/project/project.ts`: "holding a reference
   * across an instantiate or release is therefore a bug in the holder"). A
   * store row derived from a Book goes stale at exactly that moment and
   * nothing else announces it — an edit would, eventually, which is precisely
   * the kind of "correct once you touch it" behaviour this union exists to
   * stop.
   */
  | { readonly kind: "seat.open"; readonly books: readonly BookId[] }
  | { readonly kind: "seat.close"; readonly books: readonly BookId[] };

/**
 * The Books an event moved, or `"all"` when it moved the project as a whole.
 *
 * `"all"` is not a shrug — it is the honest answer for the two events that
 * replace the project under the UI. Everything else names its Books, and that
 * is what keeps a keystroke in RUT from touching PSA's row.
 */
export const booksOf = (event: ShellEvent): readonly BookId[] | "all" => {
  switch (event.kind) {
    case "book.apply":
    case "book.write":
    case "journal.restore":
    case "seat.open":
    case "seat.close":
      return event.books;
    case "project.open":
    case "remote.transfer":
      return "all";
    case "corpus.publish":
      // A publication changes findings, not save state. No book's row moves.
      return [];
  }
};
