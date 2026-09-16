/**
 * What can change the UI, enumerated.
 *
 * The shell bridges a core that owns no signals (`pnpm boundaries`) to a Solid
 * tree that needs them, and until now it did so with one counter: `bump()`
 * said *something changed somewhere* and every derived read in the
 * application recomputed. The information to do better was always present —
 * an accepted edit knows its Book, a save knows which files it wrote — and
 * `bump()` was the thing throwing it away.
 *
 * So this is that information, kept: a closed union of the events that can
 * move the project's derived state, each naming the Books it moved. Being
 * closed is the point. `bump()` made "what can change the UI" unanswerable;
 * a union makes it a list you can read, and a store can subscribe to the
 * variants it actually cares about instead of to all change everywhere.
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

import type { BookId } from "../core/book/book";

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
  | { readonly kind: "corpus.publish" };

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
      return event.books;
    case "project.open":
    case "remote.transfer":
      return "all";
    case "corpus.publish":
      // A publication changes findings, not save state. No book's row moves.
      return [];
  }
};
