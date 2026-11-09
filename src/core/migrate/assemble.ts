import {
  createBible,
  edit,
  read as readManifest,
  type NewBibleProject,
  type NewBook,
} from "@wycliffeassociates/scripture-kitchen/bento";
import { bookName } from "@wycliffeassociates/sefer-text/location/bookName";
import { Data, Effect, FileSystem, Option } from "effect";

import { joinPath } from "../fileSystem/path";
import { DEFAULT_BRANCH, Git, type Author, type GitError } from "../git/git";
import { intakeRepository, type IntakeResult } from "../git/intake";
import type { Repositories } from "../git/repository";
import { Observability } from "../observability";
import type { RelatedResource } from "../resources/relationships";
import { candidateLabel, readHistory, type StagedBook } from "./candidate";
import { readUpstreams, upstreamsText, UPSTREAMS_FILE, type Upstream } from "./upstreams";
import { WriterEngine, type Replayed, type Signature, type WriterHistory } from "./writerEngine";

class AssembleError extends Data.TaggedError("AssembleError")<{
  readonly reason: "Exists" | "Invalid" | "Io" | "History";
  readonly description: string;
}> {}

/** What the migration form asks; bento's `createBible` takes it with Sefer's policy added. */
export interface AssembleForm {
  readonly title: string;
  readonly language: {
    readonly id: string;
    readonly name: string;
    readonly direction: "ltr" | "rtl";
  };
  readonly resource: string;
  readonly contributors: readonly string[];
  readonly sources: readonly RelatedResource[];
  readonly checkingLevel: string;
  readonly rights: string;
}

const dedupeSources = (sources: readonly RelatedResource[]): readonly RelatedResource[] => {
  const seen = new Set<string>();
  return sources.filter((ref) => {
    const key = `${ref.language}/${ref.resource}/${ref.version ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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
    // bento's createBible drops a name twice over (`Mwila_Chanda`, `mwila chanda`).
    contributors: books.flatMap((book) => [
      ...book.project.translators,
      ...book.authors.map((author) => author.name),
    ]),
    sources: dedupeSources(books.flatMap((book) => book.project.sources)),
    checkingLevel: "1",
    rights: "CC-BY-SA-4.0",
  };
};

/** Sefer's policy for what a new project's manifests say beyond the form. */
export interface Policy {
  /** An ISO 8601 date-time: the manifests' creation date, and the closing commit's. */
  readonly createdAt: string;
  /** The `owner/repo` the project is expected to be pushed to. */
  readonly repository: string;
  /** Sefer's build, for the Burrito's `generator`. */
  readonly version: string;
}

const projectOf = (form: AssembleForm, policy: Policy): Omit<NewBibleProject, "books"> => ({
  title: form.title,
  abbreviation: form.resource,
  language: { tag: form.language.id, name: form.language.name, direction: form.language.direction },
  sources: form.sources.map((ref) => ({
    language: ref.language,
    resource: ref.resource,
    ...(ref.version === undefined ? {} : { version: ref.version }),
  })),
  contributors: [...form.contributors],
  publisher: "Wycliffe Associates",
  creator: "Bible translation community",
  rights: form.rights,
  checkingLevel: form.checkingLevel,
  copyright: `Licensed under ${form.rights}.`,
  generator: { name: "Sefer", version: policy.version },
  createdAt: policy.createdAt,
  repository: policy.repository,
});

const secondsOf = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

const signatureOf = (author: Author, iso: string): Signature => ({
  name: author.name,
  email: author.email,
  at: secondsOf(iso),
  offset: -new Date(iso).getTimezoneOffset(),
});

const titleOf = (staged: StagedBook): string =>
  /^\\h\s+(.+)$/m.exec(staged.usfm)?.[1]?.trim() ?? bookName(staged.project.book);

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

const writePack = (fileSystem: FileSystem.FileSystem, root: string, replayed: Replayed) =>
  Effect.gen(function* () {
    const git = joinPath(root, ".git");
    for (const folder of ["objects/pack", "objects/info", "refs/heads", "refs/tags"])
      yield* fileSystem.makeDirectory(joinPath(git, folder), { recursive: true });
    yield* fileSystem.writeFile(joinPath(git, `objects/pack/${replayed.name}.pack`), replayed.pack);
    yield* fileSystem.writeFile(joinPath(git, `objects/pack/${replayed.name}.idx`), replayed.idx);
  });

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

/** Histories bttwriter has replayed: their handles are used up, so a second try reads them again. */
const spent = new WeakSet<WriterHistory>();

/**
 * The staged books that have saves to replay, each with a handle bttwriter
 * still holds; the rest are taken as they were rendered.
 */
const withHistory = (books: readonly StagedBook[]) =>
  Effect.gen(function* () {
    const replaying: StagedBook[] = [];
    const histories: WriterHistory[] = [];
    for (const staged of books) {
      if (staged.history === undefined || staged.history.saves === 0) continue;
      const handle = spent.has(staged.history)
        ? yield* Effect.mapError(
            readHistory(staged.root, staged.source),
            (error) => new AssembleError({ reason: "History", description: error.description }),
          )
        : staged.history;
      replaying.push(staged);
      histories.push(handle);
    }
    const loose = books.filter((staged) => !replaying.includes(staged));
    return { replaying, histories, loose };
  });

const newBook = (staged: StagedBook): NewBook => ({
  book: staged.project.book,
  title: titleOf(staged),
  bytes: encode(staged.usfm),
});

/** Each book's file, as the manifests bento wrote list it. */
const pathsIn = (manifests: ReadonlyMap<string, Uint8Array>): ReadonlyMap<string, string> => {
  const paths = new Map<string, string>();
  for (const [name, bytes] of manifests)
    for (const entry of readManifest(name, bytes).manifest?.books ?? [])
      if (entry.path !== undefined && !paths.has(entry.book))
        paths.set(entry.book, entry.path.replace(/^\.\//, ""));
  return paths;
};

const failure = (reason: AssembleError["reason"]) => (cause: unknown) =>
  new AssembleError({
    reason,
    description: cause instanceof Error ? cause.message : String(cause),
  });

const upstreamsOf = (books: readonly StagedBook[], date: string): Upstream[] =>
  books.flatMap((staged) =>
    staged.upstream === undefined
      ? []
      : [
          {
            books: [staged.project.book],
            via: "git" as const,
            url: staged.upstream.url,
            commit: staged.upstream.commit,
            takenAt: date,
          },
        ],
  );

const replayStats = (replayed: Replayed | undefined): Readonly<Record<string, number>> =>
  replayed === undefined
    ? { "migrate.commits": 0 }
    : {
        "migrate.commits": replayed.commits,
        "migrate.unchanged": replayed.unchanged,
        "migrate.estimated": replayed.estimated,
        "migrate.objects": replayed.stats.objects,
        "migrate.deltas": replayed.stats.deltas,
        "migrate.pack_bytes": replayed.stats.packBytes,
      };

/**
 * A new project from the staged books. With Writer histories, bttwriter's
 * `consolidate` makes the whole line: every save as a commit, then a closing
 * commit in Sefer's words holding the books and their manifests. Books with
 * no history, and `.upstreams.json`, follow in one more commit; without any
 * history, bento's `createBible` writes the manifests and that commit is the
 * only one.
 */
export const assemble = (options: {
  readonly root: string;
  readonly form: AssembleForm;
  readonly books: readonly StagedBook[];
  readonly author: Author;
  readonly policy: Policy;
}): Effect.Effect<
  IntakeResult,
  AssembleError,
  FileSystem.FileSystem | Git | Repositories | WriterEngine
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const io = (error: { readonly message: string }) =>
      new AssembleError({ reason: "Io", description: error.message });
    if (yield* Effect.orElseSucceed(fileSystem.exists(options.root), () => true))
      return yield* Effect.fail(
        new AssembleError({ reason: "Exists", description: `${options.root} already exists` }),
      );

    const project = projectOf(options.form, options.policy);
    const date = options.policy.createdAt.slice(0, 10);
    const upstreams = upstreamsOf(options.books, date);
    const { replaying, histories, loose } = yield* withHistory(options.books);

    yield* Effect.mapError(fileSystem.makeDirectory(options.root, { recursive: true }), io);

    const build = Effect.gen(function* () {
      const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
      const replayingSpan = observability?.span("migrate.history", undefined, {
        "migrate.books": histories.length,
        "migrate.saves": histories.reduce((sum, history) => sum + history.saves, 0),
      });
      const abandon = (description: string) => {
        replayingSpan?.({ "migrate.reason": description });
        observability?.note("migrate.history", "failed", description);
        return Effect.fail(new AssembleError({ reason: "History", description }));
      };

      let manifests: ReadonlyMap<string, Uint8Array>;
      let replayed: Replayed | undefined;
      if (histories.length > 0) {
        const bttwriter = yield* Effect.catch((yield* WriterEngine).load, (error) =>
          abandon(`the Writer history could not be replayed: ${error.reason}`),
        );
        histories.forEach((history) => spent.add(history));
        const consolidated = yield* Effect.catch(
          Effect.try({
            try: () =>
              bttwriter.consolidate(
                histories,
                { now: secondsOf(options.policy.createdAt) },
                project,
                {
                  author: signatureOf(options.author, options.policy.createdAt),
                  message: `${assemblyMessage(options.form, replaying)}\n`,
                },
              ),
            catch: failure("History"),
          }),
          (error) => abandon(`the Writer history could not be replayed: ${error.description}`),
        );
        yield* Effect.catch(writeHistory(fileSystem, options.root, consolidated), (error) =>
          abandon(`the Writer history could not be written: ${error.message}`),
        );
        replayed = consolidated;
        manifests = consolidated.manifests;
        if (loose.length > 0)
          manifests = new Map([
            ...manifests,
            ...(yield* Effect.try({
              try: () => edit(manifests, { addBooks: loose.map(newBook) }).files,
              catch: failure("Invalid"),
            })),
          ]);
      } else
        manifests = yield* Effect.try({
          try: () => createBible({ ...project, books: loose.map(newBook) }),
          catch: failure("Invalid"),
        });

      const paths = pathsIn(manifests);
      const written: string[] = [];
      const write = (name: string, bytes: Uint8Array) =>
        Effect.map(
          Effect.mapError(fileSystem.writeFile(joinPath(options.root, name), bytes), io),
          () => {
            written.push(name);
          },
        );
      for (const staged of options.books) {
        const path = paths.get(staged.project.book);
        if (path === undefined)
          return yield* Effect.fail(
            new AssembleError({
              reason: "Invalid",
              description: `the manifests do not list ${staged.project.book}`,
            }),
          );
        yield* write(path, encode(staged.usfm));
      }
      for (const [name, bytes] of manifests) yield* write(name, bytes);
      if (upstreams.length > 0) yield* write(UPSTREAMS_FILE, encode(upstreamsText(upstreams)));

      const result = yield* Effect.mapError(
        intakeRepository({
          root: options.root,
          written,
          from: "Writer",
          author: options.author,
          message:
            replayed === undefined
              ? assemblyMessage(options.form, options.books)
              : loose.length > 0
                ? assemblyMessage({ ...options.form, title: "Books" }, loose)
                : "Where each book came from in Writer",
        }),
        (error) =>
          new AssembleError({
            reason: "Io",
            description: "description" in error ? String(error.description) : String(error),
          }),
      );
      if (replayed !== undefined && !result.adopted)
        return yield* abandon("the replayed Writer history could not be opened");
      replayingSpan?.(replayStats(replayed));
      return result;
    });
    return yield* Effect.tapError(build, () =>
      Effect.ignore(fileSystem.remove(options.root, { recursive: true })),
    );
  });

const readIfThere = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<Uint8Array | undefined> =>
  Effect.orElseSucceed(fileSystem.readFile(path), () => undefined);

const MANIFESTS = ["metadata.json", "manifest.yaml"] as const;

/**
 * Books added to an existing project. Their Writer saves are replayed by
 * bttwriter as a side line with no root in common, and the books arrive in a
 * merge of that line, with the project's manifests edited by bento (only the
 * new entries' lines change).
 */
export const addBooks = (options: {
  readonly root: string;
  readonly books: readonly StagedBook[];
  readonly held: readonly string[];
  readonly author: Author;
  readonly date: string;
}): Effect.Effect<
  IntakeResult,
  AssembleError,
  FileSystem.FileSystem | Git | Repositories | WriterEngine
> =>
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

    const existing = new Map<string, Uint8Array>();
    for (const name of MANIFESTS) {
      const bytes = yield* readIfThere(fileSystem, joinPath(options.root, name));
      if (bytes !== undefined) existing.set(name, bytes);
    }
    const edited = yield* Effect.try({
      try: () => edit(existing, { addBooks: options.books.map(newBook) }),
      catch: failure("Invalid"),
    });
    const listed = pathsIn(edited.files);

    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
    for (const finding of edited.findings)
      observability?.note("migrate.manifest", "declined", finding.message, {
        "manifest.check": finding.check,
      });
    const { histories } = yield* withHistory(options.books);
    const replayingSpan = observability?.span("migrate.history", undefined, {
      "migrate.books": histories.length,
      "migrate.side_branch": true,
    });
    let replayed: Replayed | undefined;
    if (histories.length > 0) {
      const bttwriter = yield* Effect.mapError(
        (yield* WriterEngine).load,
        (error) =>
          new AssembleError({
            reason: "History",
            description: `the Writer history could not be replayed: ${error.reason}`,
          }),
      );
      histories.forEach((history) => spent.add(history));
      replayed = yield* Effect.try({
        try: () => bttwriter.replay(histories, { now: secondsOf(new Date().toISOString()) }),
        catch: (cause) =>
          new AssembleError({
            reason: "History",
            description: `the Writer history could not be replayed: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      });
    }
    const files = new Map(replayed?.books.map((entry) => [entry.book, entry.file] as const) ?? []);
    const pathOf = (book: string): string => listed.get(book) ?? files.get(book) ?? `${book}.usfm`;

    for (const staged of options.books) {
      const path = joinPath(options.root, pathOf(staged.project.book));
      if (yield* Effect.orElseSucceed(fileSystem.exists(path), () => true))
        return yield* Effect.fail(
          new AssembleError({ reason: "Exists", description: `${path} already exists` }),
        );
    }

    if (replayed !== undefined)
      yield* Effect.mapError(
        writePack(fileSystem, options.root, replayed),
        (error) =>
          new AssembleError({
            reason: "History",
            description: `the Writer history could not be written: ${error.message}`,
          }),
      );
    replayingSpan?.(replayStats(replayed));

    const written: string[] = [];
    const write = (name: string, bytes: Uint8Array) =>
      Effect.map(
        Effect.mapError(fileSystem.writeFile(joinPath(options.root, name), bytes), io),
        () => {
          written.push(name);
        },
      );

    for (const staged of options.books)
      yield* write(pathOf(staged.project.book), encode(staged.usfm));
    for (const [name, bytes] of edited.files) yield* write(name, bytes);

    const fresh = upstreamsOf(options.books, options.date);
    if (fresh.length > 0) {
      const held = yield* readIfThere(fileSystem, joinPath(options.root, UPSTREAMS_FILE));
      const known =
        held === undefined
          ? []
          : Option.getOrElse(readUpstreams(new TextDecoder().decode(held)), () => []);
      const adding = new Set(fresh.flatMap((upstream) => upstream.books));
      const kept = known.filter((upstream) => !upstream.books.some((book) => adding.has(book)));
      yield* write(UPSTREAMS_FILE, encode(upstreamsText([...kept, ...fresh])));
    }

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
