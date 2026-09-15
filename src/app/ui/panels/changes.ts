/**
 * "What have I changed?", as the history and save panels both need to ask it.
 *
 * There are TWO baselines and they answer different questions, so both live
 * here rather than one being mistaken for the other:
 *
 *   * `unsavedChanges` is against the last write to DISK
 *     (`SaveCoordinator.baseline`). Nothing writes on a timer, so this is
 *     non-empty for as long as there is unrecorded work. It is a status line,
 *     not a review.
 *   * `recordedChanges` is against the last recorded VERSION (the blob at
 *     HEAD, read by `recorded.ts`). This is what a review screen means by
 *     "what has changed", and the only one a commit should be built from.
 *
 * Nothing here subscribes to anything — the caller reads `shell.tick()` to
 * make the answer reactive, which is the single-subscription rule the shell
 * documents.
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
import type { Recorded } from "./recorded";

export interface BookChanges {
  readonly bookId: BookId;
  readonly path: string;
  readonly book: Book;
  readonly hunks: readonly Hunk[];
  /** Lines the working text has that the baseline did not. */
  readonly added: number;
  /** Lines the baseline had that the working text does not. */
  readonly removed: number;
  /**
   * Set when there is no baseline at all — a book the recorded version has
   * never seen. `hunks` is empty on purpose: a diff against nothing is the
   * whole file, which nobody reads as a review, so the panel says "first time"
   * and gives the line count instead.
   */
  readonly firstTime?: boolean;
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
 * Every book whose working text differs from the last RECORDED version.
 *
 * This is the review answer, and it does not care what is on disk: a file
 * written by a commit that then failed is still not in the history. A book
 * HEAD has never seen is
 * reported as `firstTime`, so "nothing recorded yet" reads as five books about
 * to be recorded rather than as a clean project.
 */
export const recordedChanges = (shell: Shell, recorded: Recorded): readonly BookChanges[] => {
  shell.tick();
  const project = shell.project();
  if (project === undefined || !recorded.read) return [];
  const out: BookChanges[] = [];
  for (const book of project.books) {
    const at = recorded.texts.get(book.id);
    if (at === undefined) {
      out.push({
        bookId: book.id,
        path: book.path,
        book,
        hunks: [],
        added: lines(book.source().text).length,
        removed: 0,
        firstTime: true,
      });
      continue;
    }
    const changed = changesOf(book, { bookId: book.id, stamp: at.stamp, text: at.text });
    if (changed.hunks.length > 0) out.push(changed);
  }
  return out;
};

/**
 * Every open book whose working text differs from what was last WRITTEN.
 *
 * The status-line answer, not the review one. Under explicit-only saving it
 * usually agrees with `recordedChanges` — writing the file and recording the
 * version are one action — and the two part company in exactly one case: a
 * write that succeeded under a commit that did not. A book with no baseline is
 * skipped rather than reported as wholly new — Save adopts a baseline where
 * the shell opens a book, so "no baseline" means this book was never opened in
 * this session and there is nothing on screen to diff.
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
