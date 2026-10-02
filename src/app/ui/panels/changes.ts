/**
 * "What have I changed?", as History and Review both need to ask it.
 *
 * `unsavedChanges` is against the last write to DISK
 * (`SaveCoordinator.baseline`) — what the file holds right now. This is the
 * REVIEW answer, the sidebar's Changes tab: under explicit-only saving the
 * file is exactly the thing a reader has not yet agreed to change, and the
 * books that differ from it are the books they are about to record. History
 * asks a different question — what one recorded version changed — through
 * `versionChanges`, and the last recorded version is not a baseline anywhere.
 *
 * Nothing here subscribes to a Book — each walk reads `shell.stampOf` to
 * make the answer reactive, which is the single-subscription rule the shell
 * documents.
 *
 * What changed is the ENGINE's answer, in decision units (`core/diff/units`):
 * the same alignment Review uses, so the two screens cannot disagree about
 * which verses moved. The counts are counts of those units, not a second
 * diff: a summary that disagreed with the list beneath it would be worse than
 * no summary.
 */

import { Option, Result } from "effect";

import type { Book, BookId } from "#core/book/book";
import { textChanges, unitChanges, type BaselineLike, type UnitChanges } from "#core/diff/units";
import type { GalleyService } from "#core/galley";

import type { Shell } from "../../ProjectContext";
import { lines } from "./format";

export interface BookChanges {
  readonly bookId: BookId;
  readonly path: string;
  readonly book: Book;
  /** The changed units, and the two texts and the stamp they were computed over. */
  readonly changes: UnitChanges | undefined;
  /** Units only the working text has. */
  readonly added: number;
  /** Units only the baseline had. */
  readonly removed: number;
  /** Units both have, in different words or markup. */
  readonly modified: number;
  /**
   * Set when there is no baseline at all — a book the recorded version has
   * never seen. `changes` is absent on purpose: a diff against nothing is the
   * whole file, which nobody reads as a review, so the panel says "first time"
   * and gives the line count instead (`added`).
   */
  readonly firstTime?: boolean;
}

/** How many units changed, of each kind. */
export const changeCount = (changes: BookChanges): number => changes.changes?.units.length ?? 0;

/**
 * One book against one baseline-shaped value. A book the engine refused to
 * diff is reported with no units, which drops it upstream — there is no
 * second opinion about what changed.
 */
export const changesOf = (
  galley: GalleyService,
  book: Book,
  baseline: BaselineLike,
): BookChanges => {
  const found = unitChanges(galley, book, baseline);
  const changes = Result.isSuccess(found) ? found.success : undefined;
  const units = changes?.units ?? [];
  return {
    bookId: book.id,
    path: book.path,
    book,
    changes,
    added: units.filter((unit) => unit.status === "added").length,
    removed: units.filter((unit) => unit.status === "deleted").length,
    modified: units.filter((unit) => unit.status !== "added" && unit.status !== "deleted").length,
  };
};

/**
 * What ONE version did to one book: its text against the book's version before
 * it, as a log shows a commit. `before` absent is the earliest version this
 * device holds of the book, shown as its first. Read-only — neither side is
 * the book in hand, so nothing here can be reverted from it.
 */
export const versionChanges = (
  galley: GalleyService,
  book: Book,
  before: BaselineLike | undefined,
  after: BaselineLike,
): BookChanges => {
  if (before === undefined)
    return {
      bookId: book.id,
      path: book.path,
      book,
      changes: undefined,
      added: lines(after.text).length,
      removed: 0,
      modified: 0,
      firstTime: true,
    };
  const found = textChanges(galley, book.id, after.stamp, before.text, after.text);
  const changes = Result.isSuccess(found) ? found.success : undefined;
  const units = changes?.units ?? [];
  return {
    bookId: book.id,
    path: book.path,
    book,
    changes,
    added: units.filter((unit) => unit.status === "added").length,
    removed: units.filter((unit) => unit.status === "deleted").length,
    modified: units.filter((unit) => unit.status !== "added" && unit.status !== "deleted").length,
  };
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
    // The file's text and the book's, compared before anything is diffed:
    // an untouched book costs one string comparison.
    if (baseline.value.text === book.source().text) continue;
    const changed = changesOf(shell.services.galley, book, baseline.value);
    if (changeCount(changed) > 0) out.push(changed);
  }
  return out;
};
