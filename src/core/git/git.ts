/**
 * The Git port: the intersection of the user's version-control jobs, not the
 * union of two libraries' APIs. Desktop answers it with git2 behind Tauri
 * commands, the Web with isomorphic-git over the Effect `FileSystem` — so the
 * port names only what both can do and what a scripture editor actually needs:
 * open a project's repository, commit exactly what Save wrote, read history,
 * and read the bytes of an earlier version.
 *
 * Nothing here knows a library exists. `src/platform/web/git.ts` and
 * `src/platform/tauri/git.ts` are the Layers; `contract.ts` is the one suite
 * both must pass.
 */
import { Context, Data, Effect, Option } from "effect";

import { escapesRoot, normalisePath } from "../fileSystem/path";
import type { SourceStamp } from "../source/source";

/** A commit's object id, opaque to core: a hex SHA on both hosts today. */
export type CommitId = string;

/** An open repository. `root` is the project folder — the work tree, not `.git`. */
export interface Repo {
  readonly root: string;
}

/**
 * The part of SaveCoordinator's `SaveReceipt` that Git needs, declared
 * structurally so the port does not depend on the Save module. Git commits
 * receipts and nothing else, so `path` is the whole contract and `stamp` is
 * carried only to keep a receipt recognisable at a glance.
 */
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
  /** Commit time in milliseconds since the epoch. */
  readonly at: number;
}

export type ChangeKind = "added" | "modified" | "deleted" | "untracked";

export interface ChangedPath {
  /** Repository-relative, forward slashes — the shape both libraries speak. */
  readonly path: string;
  readonly kind: ChangeKind;
}

export interface Status {
  readonly changed: readonly ChangedPath[];
}

/**
 * A file as it stood at one commit. The bytes are deferred: history lists are
 * long, and a version's content is read only when something displays or
 * diffs it.
 */
export interface Version {
  readonly commit: Commit;
  readonly bytes: () => Effect.Effect<Uint8Array, GitError>;
}

/**
 * `NotARepository` — the folder has no repository to open.
 * `Io` — the host's storage or the object database refused the operation.
 * `Conflict` — the repository's state contradicts the request (a merge in
 * progress, a rev that does not name what was asked for).
 * `Refused` — Sefer declined before touching the repository: a receipt path
 * outside the root, or a host whose implementation is not wired yet.
 */
export type GitFailureReason = "NotARepository" | "Io" | "Conflict" | "Refused";

export class GitError extends Data.TaggedError("GitError")<{
  readonly reason: GitFailureReason;
  readonly description?: string | undefined;
}> {}

export interface GitService {
  /** Fails with `NotARepository` rather than creating one. */
  readonly open: (root: string) => Effect.Effect<Repo, GitError>;
  /** Idempotent: initialising an existing repository opens it. */
  readonly init: (root: string) => Effect.Effect<Repo, GitError>;
  readonly status: (repo: Repo) => Effect.Effect<Status, GitError>;
  /**
   * Stages exactly the receipt paths and commits them. Nothing is committed
   * that Save did not write: an untracked scratch file, a stray editor
   * backup, or a receipt whose path falls outside `repo.root` (which is
   * `Refused`) never reaches a commit.
   */
  readonly commit: (
    repo: Repo,
    receipts: readonly SaveReceiptLike[],
    message: string,
    author: Author,
  ) => Effect.Effect<CommitId, GitError>;
  /** Newest first. With `path`, only commits that touched that path. */
  readonly log: (repo: Repo, path?: string) => Effect.Effect<readonly Commit[], GitError>;
  /**
   * Commits reachable from `ref`, newest first — `log` for a ref that is not
   * HEAD. The sync surface needs it for exactly one thing: the cloud's side of
   * the comparison, read off `refs/remotes/origin/<branch>` after a fetch.
   */
  readonly logFrom: (repo: Repo, ref: string) => Effect.Effect<readonly Commit[], GitError>;
  /**
   * `ref` as a commit id, or `None` when the repository has no such ref.
   *
   * `None` is an ANSWER, not a failure: a project attached to a repository
   * nobody has pushed to yet has no remote-tracking ref, and that is the
   * ordinary "unpublished" state rather than something to report as broken.
   */
  readonly resolve: (repo: Repo, ref: string) => Effect.Effect<Option.Option<CommitId>, GitError>;
  /** The branch HEAD is on; `None` on a detached or unborn HEAD. */
  readonly branch: (repo: Repo) => Effect.Effect<Option.Option<string>, GitError>;
  /**
   * Repository-relative paths whose content differs between two revs, with the
   * kind seen FROM `from` TO `to` — a path absent at `from` is `added`, one
   * absent at `to` is `deleted`.
   *
   * This is what makes an incoming plan possible without transferring
   * anything twice: after a fetch, the cloud's commits are already in the
   * object database, so which books and chapters would change can be worked
   * out and shown before a single byte of the work tree moves.
   */
  readonly changedPathsBetween: (
    repo: Repo,
    from: string,
    to: string,
  ) => Effect.Effect<readonly ChangedPath[], GitError>;
  /** The bytes of `path` at `rev` — a ref name or a commit id. */
  readonly show: (repo: Repo, rev: string, path: string) => Effect.Effect<Uint8Array, GitError>;
  /** The per-file history of `path`, newest first, bytes on demand. */
  readonly previousVersions: (
    repo: Repo,
    path: string,
  ) => Effect.Effect<readonly Version[], GitError>;
}

export class Git extends Context.Service<Git, GitService>()("Git") {}

/**
 * The receipts rule in one function: a saved path becomes a repository-relative
 * path, or nothing at all. `None` is the caller's cue to fail with `Refused` —
 * a path outside the project is a bug upstream, never something to commit
 * anyway. Paths already relative are accepted as given so a receipt may quote
 * either form; a relative path that climbs out of the root is refused too.
 */
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

/** `repositoryPath`, with `None` turned into the `Refused` it always means. */
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
