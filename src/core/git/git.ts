import type { SourceStamp } from "@sefer/text/source";
import { Context, Data, Effect, Option, Result } from "effect";

import { escapesRoot, normalisePath } from "../fileSystem/path";

export const DEFAULT_BRANCH = "master";

export type CommitId = string;

export interface Repo {
  readonly root: string;
}

export interface SaveReceiptLike {
  readonly path: string;
  readonly stamp: SourceStamp;
}

export interface Author {
  readonly name: string;
  readonly email: string;
}

export interface Commit {
  readonly id: CommitId;
  readonly message: string;
  readonly author: Author;
  readonly at: number;
}

export interface Signature {
  readonly name: string;
  readonly email: string;
  readonly at: number;
  readonly offset: number;
}

export interface WalkedChange {
  readonly path: string;
  readonly blob: string | null;
}

export interface WalkedCommit {
  readonly id: CommitId;
  readonly parents: readonly CommitId[];
  readonly message: string;
  readonly author: Signature;
  readonly committer: Signature;
  readonly changes: readonly WalkedChange[];
}

export type ChangeKind = "added" | "modified" | "deleted" | "untracked";

export interface ChangedPath {
  readonly path: string;
  readonly kind: ChangeKind;
}

export interface CommitOptions {
  readonly alsoParents?: readonly CommitId[];
}

export interface Status {
  readonly changed: readonly ChangedPath[];
}

export interface Version {
  readonly commit: Commit;
  readonly bytes: () => Effect.Effect<Uint8Array, GitError>;
}

export type GitFailureReason = "NotARepository" | "Io" | "Conflict" | "Refused";

export class GitError extends Data.TaggedError("GitError")<{
  readonly reason: GitFailureReason;
  readonly description?: string | undefined;
}> {}

export interface GitService {
  readonly open: (root: string) => Effect.Effect<Repo, GitError>;
  readonly init: (root: string) => Effect.Effect<Repo, GitError>;
  readonly status: (repo: Repo) => Effect.Effect<Status, GitError>;
  readonly commit: (
    repo: Repo,
    receipts: readonly SaveReceiptLike[],
    message: string,
    author: Author,
    options?: CommitOptions,
  ) => Effect.Effect<CommitId, GitError>;
  readonly mergeBase: (
    repo: Repo,
    a: string,
    b: string,
  ) => Effect.Effect<Option.Option<CommitId>, GitError>;
  readonly log: (repo: Repo, path?: string) => Effect.Effect<readonly Commit[], GitError>;
  readonly logFrom: (repo: Repo, ref: string) => Effect.Effect<readonly Commit[], GitError>;
  readonly resolve: (repo: Repo, ref: string) => Effect.Effect<Option.Option<CommitId>, GitError>;
  readonly branch: (repo: Repo) => Effect.Effect<Option.Option<string>, GitError>;
  readonly shallow: (repo: Repo) => Effect.Effect<boolean, GitError>;
  readonly changedPathsBetween: (
    repo: Repo,
    from: string,
    to: string,
  ) => Effect.Effect<readonly ChangedPath[], GitError>;
  readonly walk: (repo: Repo) => Effect.Effect<readonly WalkedCommit[], GitError>;
  readonly blobs: (
    repo: Repo,
    ids: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, Uint8Array>, GitError>;
  readonly show: (repo: Repo, rev: string, path: string) => Effect.Effect<Uint8Array, GitError>;
  readonly previousVersions: (
    repo: Repo,
    path: string,
  ) => Effect.Effect<readonly Version[], GitError>;
  readonly timeline: (
    repo: Repo,
    paths: readonly string[],
    shared?: string,
  ) => Effect.Effect<GitTimeline, GitError>;
}

export interface GitTimeline {
  readonly commits: readonly Commit[];
  readonly versions: ReadonlyMap<string, readonly Version[]>;
  readonly shared: ReadonlySet<CommitId> | undefined;
}

export const composedTimeline =
  (git: Pick<GitService, "log" | "logFrom" | "resolve" | "previousVersions">) =>
  (repo: Repo, paths: readonly string[], shared?: string): Effect.Effect<GitTimeline, GitError> =>
    Effect.gen(function* () {
      const commits = yield* git.log(repo);
      const versions = new Map<string, readonly Version[]>();
      for (const path of paths) {
        const found = yield* Effect.result(git.previousVersions(repo, path));
        if (Result.isSuccess(found)) versions.set(path, found.success);
      }
      return { commits, versions, shared: yield* sharedFrom(git, repo, shared) };
    });

export const sharedFrom = (
  git: Pick<GitService, "logFrom" | "resolve">,
  repo: Repo,
  ref: string | undefined,
): Effect.Effect<ReadonlySet<CommitId> | undefined, GitError> =>
  Effect.gen(function* () {
    if (ref === undefined) return undefined;
    const tip = yield* Effect.orElseSucceed(git.resolve(repo, ref), () => Option.none<CommitId>());
    if (Option.isNone(tip)) return undefined;
    const reached = yield* Effect.result(git.logFrom(repo, ref));
    return Result.isSuccess(reached)
      ? new Set(reached.success.map((commit) => commit.id))
      : undefined;
  });

export class Git extends Context.Service<Git, GitService>()("Git") {}

export const repositoryPath = (root: string, path: string): Option.Option<string> => {
  const normalisedRoot = normalisePath(root);
  const normalisedPath = normalisePath(path);
  if (!path.startsWith("/") && !path.startsWith("\\")) {
    return normalisedPath === "" || normalisedPath.startsWith("..")
      ? Option.none()
      : Option.some(normalisedPath);
  }
  if (escapesRoot(normalisedRoot, normalisedPath) || normalisedPath === normalisedRoot) {
    return Option.none();
  }
  return Option.some(normalisedPath.slice(normalisedRoot === "/" ? 1 : normalisedRoot.length + 1));
};

export const relativeOrRefuse = (repo: Repo, path: string): Effect.Effect<string, GitError> =>
  Option.match(repositoryPath(repo.root, path), {
    onNone: () =>
      Effect.fail(
        new GitError({
          reason: "Refused",
          description: `path is outside the repository root: ${path}`,
        }),
      ),
    onSome: Effect.succeed,
  });
