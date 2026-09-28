/**
 * Which surface reports a seated book's edits to the shell.
 *
 * Every accepted edit has to reach the shell (`ProjectContext`'s seat
 * subscription): the stamp, the save state, the corpus and every screen that
 * reads them move on it. The main editor reports ITS book itself, carrying the
 * gesture's trace; for every other book the shell reports. So the main editor
 * says so here while it is subscribed, and the shell stands aside for exactly
 * those books — not for "the focused book", which stays focused after the
 * editor has unmounted (on Review, say), and whose card edits then reached
 * nobody.
 */

import type { BookId } from "#core/book/book";

const held = new Map<BookId, number>();

/** Claims the reporting of `bookId`'s edits; returns the release. */
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

/** Is some surface already reporting `bookId`'s edits? */
export const editsReported = (bookId: BookId): boolean => held.has(bookId);
