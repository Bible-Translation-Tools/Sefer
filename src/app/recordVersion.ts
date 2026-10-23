import type { Book, BookId } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";
import { Effect, Option, Result } from "effect";

import type { Author, CommitId } from "#core/git/git";
import type { Project } from "#core/project/project";

import type { Services } from "./services";

export type RecordOutcome =
  | { readonly kind: "nothing" }
  | { readonly kind: "not-written"; readonly error: unknown }
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
  also: readonly string[] = [],
): Promise<RecordOutcome> => {
  if (books.length === 0 && also.length === 0) return { kind: "nothing" };
  const saved = await services.run(Effect.result(services.save.saveAll(project.books)));
  if (Result.isFailure(saved)) return { kind: "not-written", error: saved.failure };

  const receipts: { readonly path: string; readonly stamp: SourceStamp }[] = [];
  for (const book of books) {
    const baseline = services.save.baseline(book);
    if (Option.isNone(baseline)) continue;
    receipts.push({ path: baseline.value.path, stamp: baseline.value.stamp });
  }
  for (const path of also) receipts.push({ path, stamp: { revision: 0, length: 0 } });
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
