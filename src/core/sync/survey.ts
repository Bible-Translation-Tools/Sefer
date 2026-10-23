import { identifyBook } from "@sefer/text/book";
import { Effect, FileSystem } from "effect";

import { Galley, toLf } from "../galley";
import { Git, type ChangedPath, type Commit, type Repo } from "../git/git";
import type { Project } from "../project/project";
import { booksByPath } from "./classify";
import { bookFacts, diffThrough, type BookFacts } from "./facts";
import { incomingPlan, type IncomingPlan } from "./plan";

const USFM = /\.usfm$/iu;

export const mergeBase = (
  local: readonly Commit[],
  remote: readonly Commit[],
): Commit | undefined => {
  const theirs = new Set(remote.map((commit) => commit.id));
  return local.find((commit) => theirs.has(commit.id));
};

export interface SurveyOptions {
  readonly tracking: string;
  readonly base: Commit | undefined;
  readonly behind: readonly Commit[];
  readonly project?: Project | undefined;
}

export interface IncomingSurvey {
  readonly plan: IncomingPlan;
  readonly changed: readonly ChangedPath[];
}

const orEmpty = <A, E>(effect: Effect.Effect<A, E>, fallback: A): Effect.Effect<A> =>
  Effect.orElseSucceed(effect, () => fallback);

const textAt = (
  repo: Repo,
  rev: string,
  path: string,
): Effect.Effect<string | undefined, never, Git> =>
  Effect.orElseSucceed(
    Effect.map(
      Effect.flatMap(Git, (git) => git.show(repo, rev, path)),
      (bytes): string | undefined => toLf(new TextDecoder().decode(bytes)).text,
    ),
    () => undefined,
  );

const textHere = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  path: string,
): Effect.Effect<string | undefined> =>
  orEmpty(
    Effect.map(
      fileSystem.readFileString(`${root}/${path}`),
      (text): string | undefined => toLf(text).text,
    ),
    undefined,
  );

export const surveyIncoming = (
  repo: Repo,
  options: SurveyOptions,
): Effect.Effect<IncomingSurvey, never, Git | FileSystem.FileSystem | Galley> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const fileSystem = yield* FileSystem.FileSystem;
    const galley = yield* Galley;
    const diff = diffThrough(galley);
    const from = options.base?.id ?? options.tracking;
    // SAFETY: the fallback is the empty list, which inhabits `readonly ChangedPath[]`; the annotation only stops TypeScript inferring `never[]` and then rejecting the real answer.
    const empty = [] as readonly ChangedPath[];
    const changed = yield* orEmpty(git.changedPathsBetween(repo, from, options.tracking), empty);

    const books = options.project === undefined ? undefined : booksByPath(repo, options.project);
    const facts: BookFacts[] = [];
    for (const entry of changed) {
      if (!USFM.test(entry.path)) continue;
      const theirs = yield* textAt(repo, options.tracking, entry.path);
      const book = books?.get(entry.path);
      const mine =
        book === undefined
          ? yield* textHere(fileSystem, repo.root, entry.path)
          : book.source().text;
      const base =
        options.base === undefined ? undefined : yield* textAt(repo, options.base.id, entry.path);
      facts.push(
        bookFacts(
          {
            path: entry.path,
            bookId: identifyBook(theirs ?? mine ?? "", entry.path),
            base,
            mine,
            theirs,
          },
          diff,
        ),
      );
    }

    return { plan: incomingPlan(options.behind, facts), changed };
  });
