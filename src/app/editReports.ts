import type { BookId } from "@sefer/text/book";

const held = new Map<BookId, number>();

export const reportEdits = (bookId: BookId): (() => void) => {
  held.set(bookId, (held.get(bookId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (held.get(bookId) ?? 1) - 1;
    if (left <= 0) held.delete(bookId);
    else held.set(bookId, left);
  };
};

export const editsReported = (bookId: BookId): boolean => held.has(bookId);
