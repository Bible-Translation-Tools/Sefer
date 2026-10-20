import { trustedBy, type Book, type BookId, type Receipt } from "@sefer/text/book";
import type { Change } from "@sefer/text/source";
import { Result } from "effect";

export interface CrossBookEdit {
  readonly label: string;
  readonly books: readonly BookId[];
  readonly at: number;
  readonly receipts: readonly Receipt[];
}

interface Pending {
  readonly op: CrossBookEdit;
  readonly seen: ReadonlyMap<BookId, number>;
  readonly before: ReadonlyMap<BookId, string>;
}

export interface MultiBook {
  runAcrossBooks(
    label: string,
    plan: (book: Book) => readonly Change[] | null,
  ): CrossBookEdit | null;
  pendingUndo(): CrossBookEdit | null;
  undoPending(): boolean;
  dismissPending(): void;
  changed(fn: () => void): () => void;
}

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
