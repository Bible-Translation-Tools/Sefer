import type { Book, BookId } from "@sefer/text/book";
import { Option, Result } from "effect";

import { textChanges, unitChanges, type BaselineLike, type UnitChanges } from "#core/diff/units";
import type { GalleyService } from "#core/galley";

import type { Shell } from "../../ProjectContext";
import { lines } from "./format";

export interface BookChanges {
  readonly bookId: BookId;
  readonly path: string;
  readonly book: Book;
  readonly changes: UnitChanges | undefined;
  readonly added: number;
  readonly removed: number;
  readonly modified: number;
  readonly firstTime?: boolean;
}

export const changeCount = (changes: BookChanges): number => changes.changes?.units.length ?? 0;

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

export const unsavedChanges = (shell: Shell): readonly BookChanges[] => {
  const project = shell.project();
  if (project === undefined) return [];
  const out: BookChanges[] = [];
  for (const book of project.books) {
    shell.stampOf(book.id);
    const baseline = shell.services.save.baseline(book);
    if (Option.isNone(baseline)) continue;
    if (baseline.value.text === book.source().text) continue;
    const changed = changesOf(shell.services.galley, book, baseline.value);
    if (changeCount(changed) > 0) out.push(changed);
  }
  return out;
};
