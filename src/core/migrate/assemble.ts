/**
 * Assemble: the chosen books become one project, with their Writer history.
 *
 * What it writes into a new folder:
 *
 *   NN-BOOK.usfm       each chosen book, as the template rendered it
 *   metadata.json      the Burrito Sefer reads   } one description,
 *   manifest.yaml      the RC other tools read   } `writeMetadata.ts`
 *   .upstreams.json    which Writer project each book follows (committed:
 *                      a teammate needs to know it too)
 *
 * First the books' Writer saves, replayed (`writerHistory.ts`): each save
 * that changed a book's text is a commit of that whole book file, with its
 * own author and date, every book interleaved by time, written into the new
 * `.git` as one pack. Then ONE commit for the assembly itself — the metadata
 * and `.upstreams.json` — on top. (Will, 2026-10-09, replacing 2026-10-06's
 * single commit with no history: keeping the saves proved cheap.) The Writer
 * authors are credited with `Co-authored-by` where there is an address, and
 * by name in the body where there is not. Adding a book later is one commit.
 *
 * A history that cannot be replayed, or that intake cannot open afterwards,
 * fails the assembly and removes the half-made folder: it never quietly
 * arrives without its past.
 *
 * Nothing is sent: the project reaches a server through ordinary sync.
 */

import { Data, Effect, FileSystem, Option, Result } from "effect";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { joinPath } from "../fileSystem/path";
import { DEFAULT_BRANCH, Git, type Author, type GitError } from "../git/git";
import { intakeRepository, type IntakeResult } from "../git/intake";
import type { Repositories } from "../git/repository";
import { CANON } from "../location/canon";
import { Observability } from "../observability";
import { decodeBurritoMetadata } from "../resources/burrito";
import { fingerprint } from "../resources/checksum";
import {
  burritoText,
  dedupeContributors,
  dedupeSources,
  resourceContainerText,
  type NewProjectMetadata,
} from "../resources/writeMetadata";
import { candidateLabel, type StagedBook } from "./candidate";
import { readUpstreams, upstreamsText, UPSTREAMS_FILE, type Upstream } from "./upstreams";
import { usfmFileName } from "./writerBook";
import { replayWriterHistories, type Replayed } from "./writerHistory";

class AssembleError extends Data.TaggedError("AssembleError")<{
  readonly reason: "Exists" | "Invalid" | "Io" | "History";
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
const assemblyMessage = (form: AssembleForm, books: readonly StagedBook[]): string => {
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

/** The replayed pack and its index, into a repository's object store. */
const writePack = (fileSystem: FileSystem.FileSystem, root: string, replayed: Replayed) =>
  Effect.gen(function* () {
    const git = joinPath(root, ".git");
    for (const folder of ["objects/pack", "objects/info", "refs/heads", "refs/tags"])
      yield* fileSystem.makeDirectory(joinPath(git, folder), { recursive: true });
    yield* fileSystem.writeFile(joinPath(git, `objects/pack/${replayed.name}.pack`), replayed.pack);
    yield* fileSystem.writeFile(joinPath(git, `objects/pack/${replayed.name}.idx`), replayed.idx);
  });

/**
 * The replayed history as a repository intake can adopt: its pack and index,
 * the branch at its last commit, and HEAD on that branch. Intake writes the
 * config and commits the assembly on top.
 */
const writeHistory = (fileSystem: FileSystem.FileSystem, root: string, replayed: Replayed) =>
  Effect.gen(function* () {
    const git = joinPath(root, ".git");
    yield* writePack(fileSystem, root, replayed);
    yield* fileSystem.writeFileString(
      joinPath(git, `refs/heads/${DEFAULT_BRANCH}`),
      `${replayed.head}\n`,
    );
    yield* fileSystem.writeFileString(joinPath(git, "HEAD"), `ref: refs/heads/${DEFAULT_BRANCH}\n`);
  });

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

    // Everything from here writes into the new folder, and any failure removes
    // it again: a project never arrives half made, or without its history.
    const build = Effect.gen(function* () {
      // The Writer saves first, so the assembly commits on top of them.
      const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
      const histories = options.books.flatMap((staged) =>
        staged.history === undefined ? [] : [staged.history],
      );
      const replaying = observability?.span("migrate.history", undefined, {
        "migrate.books": histories.length,
        "migrate.saves": histories.reduce((sum, history) => sum + history.saves.length, 0),
      });
      const abandon = (description: string) => {
        replaying?.({ "migrate.reason": description });
        observability?.note("migrate.history", "failed", description);
        return Effect.fail(new AssembleError({ reason: "History", description }));
      };
      const replayed = yield* Effect.catch(
        Effect.tryPromise(() => replayWriterHistories(histories)),
        (cause) =>
          abandon(
            `the Writer history could not be replayed: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
      );
      if (replayed !== undefined)
        yield* Effect.catch(writeHistory(fileSystem, options.root, replayed), (error) =>
          abandon(`the Writer history could not be written: ${error.message}`),
        );

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

      const result = yield* Effect.mapError(
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
      // Intake starts a fresh repository when it cannot open the one it found,
      // which here would be the replayed history, lost without a word.
      if (replayed !== undefined && !result.adopted)
        return yield* abandon("the replayed Writer history could not be opened");
      replaying?.(
        replayed === undefined
          ? { "migrate.commits": 0 }
          : {
              "migrate.commits": replayed.commits,
              "migrate.unchanged": replayed.unchanged,
              "migrate.objects": replayed.stats.objects,
              "migrate.deltas": replayed.stats.deltas,
              "migrate.pack_bytes": replayed.stats.packBytes,
            },
      );
      return result;
    });
    return yield* Effect.tapError(build, () =>
      Effect.ignore(fileSystem.remove(options.root, { recursive: true })),
    );
  });

/** The text of a file under `root`, or `undefined` when it is not there. */
const readIfThere = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<string | undefined> =>
  Effect.orElseSucceed(fileSystem.readFileString(path), () => undefined);

/**
 * Brings Writer books into a project that exists: Books → "Add a book…".
 * The same arrival as an assembly, for some books, and one commit for them,
 * made on the project's own repository as it is — never adopted or begun
 * again — joining the books' replayed Writer saves as a second parent.
 *
 * Refuses a book the project already holds: no Bible prints John twice, and
 * a newer copy of one of its books is an update, which goes through Review,
 * not here. Each metadata file is updated only where the project has one: a
 * Burrito gains the ingredient, its scope and its name; a Resource
 * Container's `projects` gains the book. `.upstreams.json` gains its row.
 */
export const addBooks = (options: {
  readonly root: string;
  readonly books: readonly StagedBook[];
  readonly held: readonly string[];
  readonly author: Author;
  readonly date: string;
}): Effect.Effect<IntakeResult, AssembleError, FileSystem.FileSystem | Git | Repositories> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const io = (error: { readonly message: string }) =>
      new AssembleError({ reason: "Io", description: error.message });
    const twice = options.books.find((staged) => options.held.includes(staged.project.book));
    if (twice !== undefined)
      return yield* Effect.fail(
        new AssembleError({
          reason: "Exists",
          description: `the project already has ${twice.project.book}`,
        }),
      );

    for (const staged of options.books) {
      const path = joinPath(options.root, usfmFileName(staged.project.book));
      if (yield* Effect.orElseSucceed(fileSystem.exists(path), () => true))
        return yield* Effect.fail(
          new AssembleError({ reason: "Exists", description: `${path} already exists` }),
        );
    }

    // The added books' Writer saves, as a side branch of their own: the
    // project's history is not rewritten, the arrival joins them.
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
    const histories = options.books.flatMap((staged) =>
      staged.history === undefined ? [] : [staged.history],
    );
    const replaying = observability?.span("migrate.history", undefined, {
      "migrate.books": histories.length,
      "migrate.side_branch": true,
    });
    const replayed = yield* Effect.mapError(
      Effect.tryPromise(() => replayWriterHistories(histories)),
      (cause) =>
        new AssembleError({
          reason: "History",
          description: `the Writer history could not be replayed: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    );
    if (replayed !== undefined)
      yield* Effect.mapError(
        writePack(fileSystem, options.root, replayed),
        (error) =>
          new AssembleError({
            reason: "History",
            description: `the Writer history could not be written: ${error.message}`,
          }),
      );
    replaying?.(
      replayed === undefined
        ? { "migrate.commits": 0 }
        : {
            "migrate.commits": replayed.commits,
            "migrate.unchanged": replayed.unchanged,
            "migrate.objects": replayed.stats.objects,
            "migrate.deltas": replayed.stats.deltas,
            "migrate.pack_bytes": replayed.stats.packBytes,
          },
    );

    const written: string[] = [];
    const write = (name: string, text: string | Uint8Array) =>
      Effect.map(
        Effect.mapError(
          fileSystem.writeFile(
            joinPath(options.root, name),
            typeof text === "string" ? encode(text) : text,
          ),
          io,
        ),
        () => {
          written.push(name);
        },
      );

    const books = options.books.map((staged) => ({
      staged,
      book: staged.project.book,
      title: titleOf(staged),
      path: usfmFileName(staged.project.book),
      bytes: encode(staged.usfm),
    }));
    for (const book of books) yield* write(book.path, book.bytes);

    const burrito = yield* readIfThere(fileSystem, joinPath(options.root, "metadata.json"));
    if (burrito !== undefined) {
      const raw = yield* Effect.try({
        try: (): Record<string, unknown> => record(JSON.parse(burrito)),
        catch: () =>
          new AssembleError({ reason: "Invalid", description: "metadata.json is not JSON" }),
      });
      const next = withBooks(raw, books);
      if (Result.isFailure(decodeBurritoMetadata(next)))
        return yield* Effect.fail(
          new AssembleError({ reason: "Invalid", description: "metadata.json would not decode" }),
        );
      yield* write("metadata.json", `${JSON.stringify(next, null, 2)}\n`);
    }

    const manifest = yield* readIfThere(fileSystem, joinPath(options.root, "manifest.yaml"));
    if (manifest !== undefined) yield* write("manifest.yaml", withProjects(manifest, books));

    const fresh: Upstream[] = options.books.flatMap((staged) =>
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
    if (fresh.length > 0) {
      const text = yield* readIfThere(fileSystem, joinPath(options.root, UPSTREAMS_FILE));
      const known = text === undefined ? [] : Option.getOrElse(readUpstreams(text), () => []);
      // One upstream per book: a row left from an earlier arrival of the
      // same book is replaced, not kept beside the new one.
      const adding = new Set(fresh.flatMap((upstream) => upstream.books));
      const kept = known.filter((upstream) => !upstream.books.some((book) => adding.has(book)));
      yield* write(UPSTREAMS_FILE, upstreamsText([...kept, ...fresh]));
    }

    // The project's own repository, as it is: no adopt (that rewrites the
    // config and drops `refs/remotes`, which is where sync keeps its
    // baseline), and no fresh repository if it will not open — that would
    // throw the project's history away to make room for the books.
    const git = yield* Git;
    const failed = (what: string) => (error: GitError) =>
      new AssembleError({
        reason: "Io",
        description: `${what}: ${error.description ?? error.reason}`,
      });
    const repo = yield* Effect.mapError(
      git.open(options.root),
      failed("the project's repository would not open"),
    );
    const changed = new Set(
      (yield* Effect.mapError(
        git.status(repo),
        failed("the project's status could not be read"),
      )).changed.map((entry) => entry.path),
    );
    const receipts = written
      .filter((path) => changed.has(path))
      .map((path) => ({ path: joinPath(options.root, path), stamp: { revision: 0, length: 0 } }));
    const arrival = yield* Effect.mapError(
      git.commit(
        repo,
        receipts,
        assemblyMessage({ ...prefillForm(options.books), title: "Books" }, options.books),
        options.author,
        replayed === undefined ? undefined : { alsoParents: [replayed.head] },
      ),
      failed("the books could not be committed"),
    );
    return { repo, adopted: true, fallback: undefined, arrival };
  });

type Added = {
  readonly book: string;
  readonly title: string;
  readonly path: string;
  readonly bytes: Uint8Array;
};

/** An object's own entries as a fresh record; anything else is an empty one. */
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

/** A Burrito's raw object with the books added: ingredient, scope and name. */
const withBooks = (
  raw: Record<string, unknown>,
  books: readonly Added[],
): Record<string, unknown> => {
  const ingredients = record(raw.ingredients);
  const names = record(raw.localizedNames);
  const type = record(raw.type);
  const flavorType = record(type.flavorType);
  const scope = record(flavorType.currentScope);
  const languages = Array.isArray(raw.languages) ? raw.languages : [];
  const tag = String(record(languages[0]).tag ?? "und");
  for (const book of books) {
    const print = fingerprint(book.bytes);
    ingredients[book.path] = {
      checksum: { md5: print.md5 },
      mimeType: "text/x-usfm",
      size: print.size,
      scope: { [book.book]: [] },
    };
    scope[book.book] = [];
    names[book.book] = { short: { [tag]: book.title } };
  }
  return {
    ...raw,
    ingredients,
    localizedNames: names,
    type: { ...type, flavorType: { ...flavorType, currentScope: scope } },
  };
};

/** A Resource Container's `manifest.yaml` with the books added to `projects`. */
const withProjects = (text: string, books: readonly Added[]): string => {
  const document = record(parseYaml(text));
  const projects: unknown[] = Array.isArray(document.projects) ? [...document.projects] : [];
  for (const book of books)
    projects.push({
      title: book.title,
      identifier: book.book.toLowerCase(),
      path: `./${book.path}`,
      sort: CANON.findIndex((entry) => entry.id === book.book),
      categories: [
        CANON.find((entry) => entry.id === book.book)?.testament === "ot" ? "bible-ot" : "bible-nt",
      ],
      versification: "ufw",
    });
  return stringifyYaml({ ...document, projects });
};
