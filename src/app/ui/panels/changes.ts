/**
 * "What have I changed?", as the history and save panels both need to ask it.
 *
 * One function, because there is one answer: `diff.compare(book, baseline)`
 * over the baseline `SaveCoordinator` holds for that book. Nothing here
 * subscribes to anything — the caller reads `shell.tick()` to make the answer
 * reactive, which is the single-subscription rule the shell documents.
 *
 * The `+`/`−` counts are line counts over the hunks, not a second diff: a
 * summary that disagreed with the diff beneath it would be worse than no
 * summary.
 */

import { Option } from "effect";

import type { Book, BookId } from "../../../core/book/book";
import { compare, type Hunk } from "../../../core/diff/diff";
import type { Baseline } from "../../../core/save/baseline";
import type { Shell } from "../../ProjectContext";
import { lines } from "./format";

export interface BookChanges {
  readonly bookId: BookId;
  readonly path: string;
  readonly book: Book;
  readonly hunks: readonly Hunk[];
  /** Lines the working text has that the baseline did not. */
  readonly added: number;
  /** Lines the baseline had that the working text does not. */
  readonly removed: number;
}

export const countsOf = (
  hunks: readonly Hunk[],
): { readonly added: number; readonly removed: number } => {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    added += lines(hunk.working).length;
    removed += lines(hunk.baseline).length;
  }
  return { added, removed };
};

/** One book against one baseline-shaped value. Empty hunks are dropped upstream. */
export const changesOf = (
  book: Book,
  baseline: { readonly bookId: BookId; readonly stamp: Baseline["stamp"]; readonly text: string },
): BookChanges => {
  const hunks = compare(book, baseline);
  return { bookId: book.id, path: book.path, book, hunks, ...countsOf(hunks) };
};

/**
 * Every open book whose working text differs from what Save last wrote.
 *
 * A book with no baseline is skipped rather than reported as wholly new: Save
 * adopts a baseline where the shell opens a book, so "no baseline" means this
 * book was never opened in this session and there is nothing on screen to
 * diff.
 */
export const unsavedChanges = (shell: Shell): readonly BookChanges[] => {
  shell.tick();
  const project = shell.project();
  if (project === undefined) return [];
  const out: BookChanges[] = [];
  for (const book of project.books) {
    const baseline = shell.services.save.baseline(book);
    if (Option.isNone(baseline)) continue;
    const changed = changesOf(book, baseline.value);
    if (changed.hunks.length > 0) out.push(changed);
  }
  return out;
};
