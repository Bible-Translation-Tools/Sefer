import type { BookId } from "@sefer/text/book";
import { trustedBy } from "@sefer/text/book";
import type { Change } from "@sefer/text/source";
import { Effect, Result } from "effect";

import type { Project } from "../project/project";
import { nameOfRoot } from "../project/slug";
import { failCompare, type CompareSource } from "./source";

export type EditsBetween = (before: string, after: string) => readonly Change[] | undefined;

export const currentProjectSource = (
  project: Project,
  options: { readonly label?: string; readonly edits: EditsBetween },
): CompareSource => ({
  id: `project:${project.id}`,
  label: options.label ?? `This project (${nameOfRoot(project.root)})`,
  kind: "project",
  canApply: true,

  books: () => Effect.sync(() => project.books.map((book) => book.id)),

  read: (bookId) =>
    Effect.suspend(() => {
      const book = project.book(bookId);
      if (book === undefined)
        return failCompare("Absent", `${bookId} is not a book in ${project.root}`);
      const source = book.source();
      return Effect.succeed({ text: source.text, stamp: source.stamp });
    }),

  apply: (bookId: BookId, text: string) =>
    Effect.gen(function* () {
      if (project.book(bookId) === undefined)
        return yield* failCompare(
          "Unsupported",
          `${bookId} is not in this project; Compare cannot add a book yet`,
        );

      yield* Effect.orElseSucceed(project.instantiate(bookId), () => undefined);
      const book = project.book(bookId);
      if (book === undefined)
        return yield* failCompare("Absent", `${bookId} left the project mid-apply`);

      const current = book.source();
      if (current.text === text)
        return yield* failCompare("Refused", `${bookId} already holds exactly this text`);

      const changes = options.edits(current.text, text);
      if (changes === undefined)
        return yield* failCompare(
          "Refused",
          `${bookId}: this build's engine cannot say what changed, so nothing was written`,
        );

      const receipt = book.apply(changes, "compare", trustedBy("compare"));
      return Result.isFailure(receipt)
        ? yield* failCompare(
            "Refused",
            `${bookId}: ${receipt.failure.rule} refused (${receipt.failure.reason})`,
          )
        : receipt.success;
    }),
});
