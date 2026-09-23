/**
 * "What have I changed?", as the history and save panels both need to ask it.
 *
 * There are TWO baselines and they answer different questions, so both live
 * here rather than one being mistaken for the other:
 *
 *   * `unsavedChanges` is against the last write to DISK
 *     (`SaveCoordinator.baseline`) — what the file holds right now. This is
 *     the REVIEW answer: under explicit-only saving the file is exactly the
 *     thing a reader has not yet agreed to change, and the books that differ
 *     from it are the books they are about to record.
 *   * `recordedChanges` is against the last recorded VERSION (the blob at
 *     HEAD, read by `recorded.ts`). That is HISTORY's question — "what has
 *     happened since the last commit" — and it is the wrong one for Save &
 *     Review. It was the right one when the file was written on a timer,
 *     because then the file was not a decision; it is not any more, and using
 *     it cost an untouched 66-book project a review reading "66 books to
 *     record, diff of 92208" the first time it was opened without a
 *     repository.
 *
 * Nothing here subscribes to a Book — each walk reads `shell.stampOf` to
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

const countsOf = (hunks: readonly Hunk[]): { readonly added: number; readonly removed: number } => {
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
  const project = shell.project();
  if (project === undefined || !recorded.read) return [];
  const out: BookChanges[] = [];
  for (const book of project.books) {
    // The dependency, per book: this diff is against the book's WORKING text,
    // so it moves when that text moves and when nothing else does. `recorded`
    // is the caller's own signal and is already tracked where it is read.
    shell.stampOf(book.id);
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
 * Every book whose working text differs from the bytes in its FILE.
 *
 * The review answer. "Differs" is decided by the diff itself — LF-normalised
 * canonical text on both sides, because that is the only form a `Baseline`
 * ever holds — so a book whose line endings or byte order mark differ from
 * ours is not a change and does not list.
 *
 * A book with no baseline is skipped rather than reported as wholly new. Save
 * adopts a baseline wherever the shell opens a book (`ProjectContext.focus`)
 * and wherever Recovery replays one, so "no baseline" means nothing has
 * touched this book in this session — its text IS the file's, and listing all
 * 66 books of a project somebody merely opened is the bug this rule exists to
 * prevent.
 */
export const unsavedChanges = (shell: Shell): readonly BookChanges[] => {
  const project = shell.project();
  if (project === undefined) return [];
  const out: BookChanges[] = [];
  for (const book of project.books) {
    // Per book, for the same reason as above. A baseline is adopted where a
    // seat opens, which is an event, so the row is written before anything
    // asks — and a book with no baseline is skipped either way.
    shell.stampOf(book.id);
    const baseline = shell.services.save.baseline(book);
    if (Option.isNone(baseline)) continue;
    const changed = changesOf(book, baseline.value);
    if (changed.hunks.length > 0) out.push(changed);
  }
  return out;
};
