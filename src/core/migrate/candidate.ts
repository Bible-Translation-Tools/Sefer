import { book as canonBook } from "@wycliffeassociates/scripture-kitchen/canon";
import {
  bookName,
  testamentOf,
  type Testament,
} from "@wycliffeassociates/sefer-text/location/bookName";
import { Data, Effect, FileSystem, Option } from "effect";

import { lastSegment } from "../fileSystem/path";
import { Git, type Author } from "../git/git";
import { Observability } from "../observability";
import { Remote } from "../remote/remote";
import {
  readWriterTree,
  recognizeWriter,
  writerBookToUsfm,
  type WriterProject,
} from "./writerBook";
import { objectSource, WriterEngine, type WriterHistory } from "./writerEngine";

export type CandidateStatus = "Primary" | "Active" | "Inactive";

export type CandidateOrigin =
  | {
      readonly kind: "remote";
      readonly owner: string;
      readonly repo: string;
      readonly url: string;
    }
  | { readonly kind: "folder" | "zip"; readonly name: string; readonly root: string };

export interface BookCandidate {
  readonly id: string;
  readonly book: string;
  readonly language: string;
  readonly resource: string;
  readonly origin: CandidateOrigin;
  readonly hints: { readonly status?: CandidateStatus; readonly modified?: string };
}

export interface StagedBook {
  readonly candidate: BookCandidate;
  readonly project: WriterProject;
  /** The book at its last save (bttwriter's), or the folder's files when it has no history. */
  readonly usfm: string;
  readonly authors: readonly Author[];
  readonly upstream?: { readonly url: string; readonly commit: string };
  /**
   * The saves, held in bttwriter until the assembly replays them (which uses
   * the handle up: `assemble` reads it again from `root` for a second try).
   */
  readonly history?: WriterHistory;
  /** Where the history was read: the repository, and the name its trailers cite. */
  readonly root: string;
  readonly source: string;
}

class CandidateError extends Data.TaggedError("CandidateError")<{
  readonly reason: "NotWriter" | "Unreachable" | "Mismatch" | "History";
  readonly description: string;
}> {}

export const candidateLabel = (candidate: BookCandidate): string =>
  candidate.origin.kind === "remote" ? candidate.origin.owner : candidate.origin.name;

export const testamentOfBook = (book: string): Testament => testamentOf(book);

/** canon's place for a book; a book outside the canon's numbering sorts last. */
const canonIndex = (book: string): number =>
  canonBook(book)?.canonicalIndex ?? Number.MAX_SAFE_INTEGER;

const isWriterItself = (name: string): boolean =>
  /^(ts-?desktop|translation ?studio|btt ?writer)$/i.test(name.trim());

const authorsFrom = (project: WriterProject, committed: readonly Author[]): readonly Author[] => {
  const seen = new Set<string>();
  const out: Author[] = [];
  for (const author of [
    ...committed,
    ...project.translators.map((name) => ({ name, email: "" })),
  ]) {
    const key = author.name.trim().toLowerCase();
    if (key === "" || seen.has(key) || isWriterItself(author.name)) continue;
    seen.add(key);
    out.push(author);
  }
  return out;
};

const fallbackTitle = (project: WriterProject): string => bookName(project.book);

const render = (project: WriterProject, root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const tree = yield* readWriterTree(fileSystem, root);
    return writerBookToUsfm(tree, project.book, fallbackTitle(project));
  });

/** One Writer repository's history, read by bttwriter through the Git port. */
export const readHistory = (
  root: string,
  source: string,
): Effect.Effect<WriterHistory, CandidateError, FileSystem.FileSystem | Git | WriterEngine> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const failed = (description: string) =>
      new CandidateError({
        reason: "History",
        description: `its history could not be read: ${description}`,
      });
    const bttwriter = yield* Effect.mapError((yield* WriterEngine).load, (error) =>
      failed(error.reason),
    );
    const repo = yield* Effect.mapError(git.open(root), (error) =>
      failed(error.description ?? error.reason),
    );
    return yield* Effect.tryPromise({
      try: () => bttwriter.readHistory(objectSource(git, fileSystem, repo), { source }),
      catch: (cause) => failed(cause instanceof Error ? cause.message : String(cause)),
    });
  });

export const openCandidate = (
  candidate: BookCandidate,
  stagingRoot: string,
): Effect.Effect<
  StagedBook,
  CandidateError,
  FileSystem.FileSystem | Git | Remote | Observability | WriterEngine
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const remote = yield* Remote;
    const observability = yield* Observability;
    let root: string;
    let upstream: StagedBook["upstream"];
    if (candidate.origin.kind === "remote") {
      root = `${stagingRoot}/${candidate.origin.owner}_${candidate.origin.repo}`;
      const staged =
        (yield* Effect.orElseSucceed(fileSystem.exists(`${root}/manifest.json`), () => false)) &&
        !(yield* Effect.orElseSucceed(
          Effect.flatMap(git.open(root), (repo) => git.shallow(repo)),
          () => true,
        ));
      if (!staged) {
        const cloned = observability.span("migrate.clone");
        yield* Effect.ignore(fileSystem.remove(root, { recursive: true }));
        yield* Effect.mapError(
          remote.clone(candidate.origin.url, root, { history: "all" }),
          (error) =>
            new CandidateError({
              reason: "Unreachable",
              description: error.description ?? error.reason,
            }),
        );
        cloned();
      }
    } else root = candidate.origin.root;

    const project = yield* recognizeWriter(fileSystem, root);
    if (project === undefined)
      return yield* Effect.fail(
        new CandidateError({
          reason: "NotWriter",
          description: `${lastSegment(root)} is not a BTT Writer project`,
        }),
      );
    if (project.book !== candidate.book)
      return yield* Effect.fail(
        new CandidateError({
          reason: "Mismatch",
          description: `listed as ${candidate.book}, but its manifest says ${project.book}`,
        }),
      );

    const logged = observability.span("migrate.log");
    const committed: Author[] = [];
    const repo = yield* Effect.option(git.open(root));
    let commits = 0;
    if (repo._tag === "Some") {
      const log = yield* Effect.orElseSucceed(git.log(repo.value), () => []);
      commits = log.length;
      for (const commit of log) committed.push(commit.author);
      const head = log[0]?.id;
      const url =
        candidate.origin.kind === "remote"
          ? candidate.origin.url
          : Option.getOrUndefined(
              yield* Effect.orElseSucceed(remote.origin(repo.value), () => Option.none<string>()),
            );
      if (head !== undefined && url !== undefined) upstream = { url, commit: head };
    }

    logged({
      "migrate.repo": repo._tag === "Some",
      "migrate.commits": commits,
      "migrate.upstream": upstream !== undefined,
    });

    const source =
      candidate.origin.kind === "remote"
        ? `${candidate.origin.owner}/${candidate.origin.repo}`
        : lastSegment(root);
    let history: WriterHistory | undefined;
    if (repo._tag === "Some") {
      const read = observability.span("migrate.history.read");
      history = yield* Effect.tapError(readHistory(root, source), (error) =>
        Effect.sync(() => {
          read({ "migrate.reason": error.description });
          observability.note("migrate.history.read", "failed", error.description);
        }),
      );
      read({ "migrate.saves": history.saves });
    }
    const rendered = observability.span("migrate.render");
    const usfm =
      history !== undefined && history.saves > 0 ? history.usfm() : yield* render(project, root);
    rendered({ "migrate.bytes": usfm.length, "migrate.from_history": history !== undefined });
    return {
      candidate,
      project,
      usfm,
      authors: authorsFrom(project, committed),
      root,
      source,
      ...(upstream === undefined ? {} : { upstream }),
      ...(history === undefined ? {} : { history }),
    };
  });

const rank = (candidate: BookCandidate): number => {
  switch (candidate.hints.status) {
    case "Primary":
      return 0;
    case "Active":
      return 1;
    case "Inactive":
      return 3;
    default:
      return 2;
  }
};

/**
 * The default for one book: the only candidate; else the Primary; else the
 * newest Active (Will, 2026-10-02: nobody is sure what Active means, so it is
 * the second choice); else a local one; and a book with only Inactive
 * candidates is left out.
 */
export const defaultCandidate = (
  candidates: readonly BookCandidate[],
): BookCandidate | undefined => {
  if (candidates.length === 1) return candidates[0];
  const ranked = candidates
    .filter((candidate) => candidate.hints.status !== "Inactive")
    .sort(
      (a, b) => rank(a) - rank(b) || (b.hints.modified ?? "").localeCompare(a.hints.modified ?? ""),
    );
  return ranked[0];
};

export interface BookRow {
  readonly book: string;
  readonly candidates: readonly BookCandidate[];
}

export const groupByBook = (candidates: readonly BookCandidate[]): readonly BookRow[] => {
  const byBook = new Map<string, BookCandidate[]>();
  for (const candidate of candidates) {
    const held = byBook.get(candidate.book) ?? [];
    held.push(candidate);
    byBook.set(candidate.book, held);
  }
  return [...byBook.entries()]
    .sort(([a], [b]) => canonIndex(a) - canonIndex(b))
    .map(([book, list]) => ({ book, candidates: list }));
};
