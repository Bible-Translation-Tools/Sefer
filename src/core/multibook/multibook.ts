// multibook.ts
//
// MultiBook (seams §3.11, vision §14.4): running one labelled operation across
// many Books, and offering ONE bounded Undo for it.
//
// Cross-book operations are coordinated, not merged. There is no patch
// language, no cross-project transaction log, and no shared history: each book
// takes its own edit through its own `apply`, so every existing subscriber
// (Save, Recovery, ProjectAnalysis, the UI) sees an ordinary edit it already
// knows how to handle. What MultiBook adds is a receipt for the whole thing
// plus an Undo whose lifetime is explicitly bounded — files get saved, closed
// and changed under us, so a project command's Undo is offered only while
// every affected book still stands exactly where the operation left it.

import { Result } from "effect";

import { trustedBy, type Book, type BookId, type Receipt } from "../book/book";
import type { Change } from "../source/source";

/** What one cross-book operation did. `books` lists only the books it changed. */
export interface CrossBookEdit {
  readonly label: string;
  readonly books: readonly BookId[];
  readonly at: number;
  readonly receipts: readonly Receipt[];
}

/**
 * The one operation whose Undo is still on offer.
 *
 * `seen` is each affected book's revision immediately AFTER the operation: any
 * later edit anywhere in that set moves a revision and expires the offer.
 * `before` is each affected book's whole text from immediately BEFORE — see
 * `undoPending` for why the text, and not the receipts, is what makes the
 * plain Book undoable.
 */
interface Pending {
  readonly op: CrossBookEdit;
  readonly seen: ReadonlyMap<BookId, number>;
  readonly before: ReadonlyMap<BookId, string>;
}

export interface MultiBook {
  /**
   * Offers every book to `plan`; a non-null change list is applied as one
   * trusted `project.<label>` edit. Returns the CrossBookEdit, or `null` when no
   * book was changed (an operation that touched nothing leaves any previous
   * Undo offer alone).
   */
  runAcrossBooks(
    label: string,
    plan: (book: Book) => readonly Change[] | null,
  ): CrossBookEdit | null;
  /** The still-undoable operation, re-checked and cleared if it has expired. */
  pendingUndo(): CrossBookEdit | null;
  /** Undoes the pending operation in every affected book. False if expired. */
  undoPending(): boolean;
  /** Drops the Undo offer (the user moved on, or the UI banner was closed). */
  dismissPending(): void;
  /** Notified whenever the Undo offer appears, expires or is taken. */
  changed(fn: () => void): () => void;
}

/**
 * `books` is a thunk, not an array, because Project owns Book lifetimes and
 * instantiates and releases them as the user opens and closes things —
 * MultiBook must always see the current set, and must not keep books alive by
 * holding them.
 */
export const makeMultiBook = (books: () => readonly Book[]): MultiBook => {
  const subscribers = new Set<() => void>();
  let pending: Pending | null = null;

  const announce = (): void => {
    for (const fn of Array.from(subscribers)) fn();
  };

  const byId = (id: BookId): Book | undefined => books().find((book) => book.id === id);

  const runAcrossBooks = (
    label: string,
    plan: (book: Book) => readonly Change[] | null,
  ): CrossBookEdit | null => {
    const touched: BookId[] = [];
    const receipts: Receipt[] = [];
    const before = new Map<BookId, string>();
    const seen = new Map<BookId, number>();

    for (const book of books()) {
      const changes = plan(book);
      if (!changes || changes.length === 0) continue;
      const beforeText = book.source().text;
      // One `apply` per book, so one history event per book. Isolation is the
      // Book's business, not ours: the editor-backed Book isolates its history
      // transaction for trusted `project.*` origins precisely so this Undo
      // takes back the whole operation and nothing the user typed around it.
      const result = book.apply(changes, `project.${label}`, trustedBy(`project.${label}`));
      if (Result.isFailure(result)) continue;
      touched.push(book.id);
      receipts.push(result.success);
      before.set(book.id, beforeText);
      seen.set(book.id, book.source().stamp.revision);
    }

    if (touched.length === 0) return null;
    const op: CrossBookEdit = { label, books: touched, at: Date.now(), receipts };
    pending = { op, seen, before };
    announce();
    return op;
  };

  const pendingUndo = (): CrossBookEdit | null => {
    const held = pending;
    if (!held) return null;
    for (const [id, revision] of held.seen) {
      const book = byId(id);
      // A book that took another edit, or that Project has closed, ends the
      // offer: we can no longer promise to put things back as they were.
      if (!book || book.source().stamp.revision !== revision) {
        pending = null;
        announce();
        return null;
      }
    }
    return held.op;
  };

  const undoPending = (): boolean => {
    const op = pendingUndo();
    const held = pending;
    if (!op || !held) return false;
    pending = null;
    let any = false;

    for (const id of op.books) {
      const book = byId(id);
      if (!book) continue;
      const history = book.history();
      if (history) {
        any = history.undo() || any;
        continue;
      }
      // The plain Book has no history. The receipts record stamps, not the
      // text that was replaced, so they cannot be inverted — which is why the
      // pending record captured each book's whole text before the operation.
      // Restoring it as one whole-text `revert` change is exact (the offer only
      // stands while the book is untouched since the operation) and stays on
      // the one write path, so subscribers see it like any other edit.
      const beforeText = held.before.get(id);
      if (beforeText === undefined) continue;
      const current = book.source();
      const result = book.apply(
        [{ from: 0, to: current.text.length, insert: beforeText }],
        "revert",
        trustedBy(`project.${op.label}.undo`),
      );
      any = Result.isSuccess(result) || any;
    }

    announce();
    return any;
  };

  const dismissPending = (): void => {
    pending = null;
    announce();
  };

  return {
    runAcrossBooks,
    pendingUndo,
    undoPending,
    dismissPending,
    changed: (fn) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
};
