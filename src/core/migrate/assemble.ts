/**
 * Assemble: the chosen books become one project, in one commit.
 *
 * What it writes into a new folder:
 *
 *   NN-BOOK.usfm       each chosen book, as the template rendered it
 *   metadata.json      the Burrito Sefer reads   } one description,
 *   manifest.yaml      the RC other tools read   } `writeMetadata.ts`
 *   .upstreams.json    which Writer project each book follows (committed:
 *                      a teammate needs to know it too)
 *
 * Then ONE commit for the whole assembly (Will, 2026-10-06): Writer's
 * autosaves carry no intent worth a commit each, and their commits never
 * enter this repository. The Writer authors are credited with
 * `Co-authored-by` where there is an address, and by name in the body where
 * there is not. Adding a book later is one commit too.
 *
 * Nothing is sent: the project reaches a server through ordinary sync.
 */

import { Data, Effect, FileSystem, Result } from "effect";

import { joinPath } from "../fileSystem/path";
import type { Author, Git } from "../git/git";
import { intakeRepository, type IntakeResult } from "../git/intake";
import type { Repositories } from "../git/repository";
import { CANON } from "../location/canon";
import {
  burritoText,
  dedupeContributors,
  dedupeSources,
  resourceContainerText,
  type NewProjectMetadata,
} from "../resources/writeMetadata";
import { candidateLabel, type StagedBook } from "./candidate";
import { upstreamsText, type Upstream } from "./upstreams";
import { usfmFileName } from "./writerBook";

export class AssembleError extends Data.TaggedError("AssembleError")<{
  readonly reason: "Exists" | "Invalid" | "Io";
  readonly description: string;
}> {}

/** The project form: what the person confirmed on the last step. */
export type AssembleForm = Omit<NewProjectMetadata, "books" | "date">;

/** The form prefilled from the chosen books, to bwc_reg's convention. */
export const prefillForm = (books: readonly StagedBook[]): AssembleForm => {
  const first = books[0]?.project;
  return {
    title: "Bible",
    language: {
      id: first?.language.id ?? "",
      name: first?.language.name ?? first?.language.id ?? "",
      direction: first?.language.direction ?? "ltr",
    },
    resource: first?.resource ?? "reg",
    contributors: dedupeContributors(
      books.flatMap((book) => [
        ...book.project.translators,
        ...book.authors.map((author) => author.name),
      ]),
    ),
    sources: dedupeSources(books.flatMap((book) => book.project.sources)),
    checkingLevel: "1",
    rights: "CC-BY-SA-4.0",
  };
};

/** The book's own name, from the `\h` the template wrote. */
const titleOf = (staged: StagedBook): string =>
  /^\\h\s+(.+)$/m.exec(staged.usfm)?.[1]?.trim() ??
  CANON.find((entry) => entry.id === staged.project.book)?.name ??
  staged.project.book;

/** The assembly's message: what it is, who did the work, and their credit trailers. */
export const assemblyMessage = (form: AssembleForm, books: readonly StagedBook[]): string => {
  const authors = new Map<string, Author>();
  for (const book of books)
    for (const author of book.authors) {
      const key = author.name.trim().toLowerCase();
      const held = authors.get(key);
      if (held === undefined || (held.email === "" && author.email !== ""))
        authors.set(key, author);
    }
  const credited = [...authors.values()].filter((author) => author.email !== "");
  const named = [...authors.values()].filter((author) => author.email === "");
  const only = books.length === 1 ? books[0] : undefined;
  const lines = [
    only === undefined
      ? `${form.title}: ${String(books.length)} books from Writer`
      : `${titleOf(only)} from Writer`,
    "",
    ...books.map(
      (book) =>
        `${book.project.book}: ${book.upstream?.url ?? `${candidateLabel(book.candidate)} (${book.candidate.origin.kind})`}`,
    ),
  ];
  if (named.length > 0)
    lines.push("", `Translators: ${named.map((author) => author.name).join(", ")}`);
  if (credited.length > 0)
    lines.push("", ...credited.map((author) => `Co-authored-by: ${author.name} <${author.email}>`));
  return lines.join("\n");
};

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Writes the books, both metadata files and `.upstreams.json` into `root`,
 * which must not exist yet, and records it all as one commit.
 */
export const assemble = (options: {
  readonly root: string;
  readonly form: AssembleForm;
  readonly books: readonly StagedBook[];
  readonly author: Author;
  readonly date: string;
}): Effect.Effect<IntakeResult, AssembleError, FileSystem.FileSystem | Git | Repositories> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const io = (error: { readonly message: string }) =>
      new AssembleError({ reason: "Io", description: error.message });
    if (yield* Effect.orElseSucceed(fileSystem.exists(options.root), () => true))
      return yield* Effect.fail(
        new AssembleError({ reason: "Exists", description: `${options.root} already exists` }),
      );

    const books = options.books.map((staged) => ({
      book: staged.project.book,
      title: titleOf(staged),
      path: usfmFileName(staged.project.book),
      bytes: encode(staged.usfm),
    }));
    const form: NewProjectMetadata = { ...options.form, books, date: options.date };
    const burrito = burritoText(form);
    if (Result.isFailure(burrito))
      return yield* Effect.fail(
        new AssembleError({ reason: "Invalid", description: burrito.failure }),
      );

    const upstreams: Upstream[] = options.books.flatMap((staged) =>
      staged.upstream === undefined
        ? []
        : [
            {
              books: [staged.project.book],
              via: "git" as const,
              url: staged.upstream.url,
              commit: staged.upstream.commit,
              takenAt: options.date,
            },
          ],
    );

    yield* Effect.mapError(fileSystem.makeDirectory(options.root, { recursive: true }), io);
    const written: string[] = [];
    const write = (name: string, bytes: Uint8Array) =>
      Effect.map(
        Effect.mapError(fileSystem.writeFile(joinPath(options.root, name), bytes), io),
        () => {
          written.push(name);
        },
      );
    for (const book of books) yield* write(book.path, book.bytes);
    yield* write("metadata.json", encode(burrito.success));
    yield* write("manifest.yaml", encode(resourceContainerText(form)));
    if (upstreams.length > 0) yield* write(".upstreams.json", encode(upstreamsText(upstreams)));

    return yield* Effect.mapError(
      intakeRepository({
        root: options.root,
        written,
        from: "Writer",
        author: options.author,
        message: assemblyMessage(options.form, options.books),
      }),
      (error) =>
        new AssembleError({
          reason: "Io",
          description: "description" in error ? String(error.description) : String(error),
        }),
    );
  });
