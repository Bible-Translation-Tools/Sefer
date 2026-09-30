/**
 * Record a version: write the books' files, then keep them as one commit —
 * the one way the project file is written.
 *
 * Shared by the Review screen, where a person reads the changes first, and by
 * the save key when "Skip review of my changes" is on. The screen owns the
 * words and the toasts; this owns the order: save first, then commit exactly
 * what the saves wrote (their receipts, and what they kept current beside the
 * book — a burrito's metadata.json), so no file Sefer wrote is left
 * unrecorded and no file it did not write rides along.
 */
import { Effect, Option, Result } from "effect";

import type { Book, BookId } from "#core/book/book";
import type { Author, CommitId } from "#core/git/git";
import type { Project } from "#core/project/project";
import type { SourceStamp } from "#core/source/source";

import type { Services } from "./services";

export type RecordOutcome =
  /** Nothing differed from the files. */
  | { readonly kind: "nothing" }
  /** The files could not be written; nothing changed. */
  | { readonly kind: "not-written"; readonly error: unknown }
  /** The files hold the text and no commit holds the files: "on disk, not recorded". */
  | { readonly kind: "not-recorded"; readonly error: unknown; readonly books: readonly BookId[] }
  | {
      readonly kind: "recorded";
      readonly commit: CommitId;
      readonly receipts: number;
      readonly books: readonly BookId[];
    };

export const recordVersion = async (
  services: Services,
  project: Project,
  books: readonly Book[],
  message: string,
  author: Author,
): Promise<RecordOutcome> => {
  if (books.length === 0) return { kind: "nothing" };
  const saved = await services.run(Effect.result(services.save.saveAll(project.books)));
  if (Result.isFailure(saved)) return { kind: "not-written", error: saved.failure };

  const receipts: { readonly path: string; readonly stamp: SourceStamp }[] = [];
  for (const book of books) {
    const baseline = services.save.baseline(book);
    if (Option.isNone(baseline)) continue;
    receipts.push({ path: baseline.value.path, stamp: baseline.value.stamp });
  }
  if (receipts.length === 0) return { kind: "nothing" };
  const staged = new Set(receipts.map((receipt) => receipt.path));
  for (const receipt of saved.success)
    for (const path of receipt.also)
      if (!staged.has(path)) {
        staged.add(path);
        receipts.push({ path, stamp: receipt.stamp });
      }

  const ids = books.map((book) => book.id);
  const recorded = await services.run(
    Effect.result(
      Effect.gen(function* () {
        const repo = yield* services.git.init(project.root);
        return yield* services.git.commit(repo, receipts, message, author);
      }),
    ),
  );
  return Result.isFailure(recorded)
    ? { kind: "not-recorded", error: recorded.failure, books: ids }
    : { kind: "recorded", commit: recorded.success, receipts: receipts.length, books: ids };
};
