/**
 * The Web answer to the `Git` port: isomorphic-git driven over the Effect
 * `FileSystem` through `nodeFsView`, so the same repository the OPFS layer
 * stores is the one Git reads. This file is the only place in the Web host
 * that knows isomorphic-git exists; core sees the port.
 */
import { Buffer } from "buffer";

import { Effect, FileSystem, Layer, Option } from "effect";
import git from "isomorphic-git";

import { nodeFsView } from "../../core/fileSystem/nodeView";
import {
  type Author,
  type Commit,
  type CommitId,
  Git,
  GitError,
  type GitFailureReason,
  type GitService,
  type Repo,
  repositoryPath,
  type SaveReceiptLike,
  type Status,
  type Version,
} from "../../core/git/git";

// isomorphic-git 1.38.4 reads a global `Buffer` (`Buffer.from`, `Buffer.alloc`,
// `Buffer.concat`, `Buffer.isBuffer`) and no bundler supplies one to a browser
// build. The Web host must install one before calling into Git.
Object.assign(globalThis, { Buffer });

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const failed = (reason: GitFailureReason, error: unknown): GitError =>
  new GitError({ reason, description: describeError(error) });

/** Every call into isomorphic-git funnels through here, so no throw escapes. */
const attempt = <A>(reason: GitFailureReason, call: () => Promise<A>): Effect.Effect<A, GitError> =>
  Effect.tryPromise({ try: call, catch: (error) => failed(reason, error) });

const refuse = (description: string): Effect.Effect<never, GitError> =>
  Effect.fail(new GitError({ reason: "Refused", description }));

/**
 * Repository-relative or nothing. Callers pass paths in whichever form they
 * hold — a `SaveReceipt` path is absolute, a history request may already be
 * relative — and anything outside the work tree is refused before Git runs.
 */
const relativeOrRefuse = (repo: Repo, path: string): Effect.Effect<string, GitError> =>
  Option.match(repositoryPath(repo.root, path), {
    onNone: () => refuse(`path is outside the repository root: ${path}`),
    onSome: Effect.succeed,
  });

const commitOf = (entry: {
  readonly oid: string;
  readonly commit: {
    readonly message: string;
    readonly author: { readonly name: string; readonly email: string; readonly timestamp: number };
  };
}): Commit => ({
  id: entry.oid,
  message: entry.commit.message.trimEnd(),
  author: { name: entry.commit.author.name, email: entry.commit.author.email },
  at: entry.commit.author.timestamp * 1000,
});

/**
 * isomorphic-git reports status as a matrix of `[path, head, workdir, stage]`
 * counters rather than named states; this is the translation to the four kinds
 * the port names. Rows where all three agree are unchanged and dropped.
 */
const changeKindOf = (
  head: number,
  workdir: number,
  stage: number,
): "added" | "modified" | "deleted" | "untracked" | null => {
  if (head === 0 && stage === 0) return workdir === 0 ? null : "untracked";
  if (head === 0) return "added";
  if (workdir === 0) return "deleted";
  return head === 1 && workdir === 1 && stage === 1 ? null : "modified";
};

const makeWebGit = (fileSystem: FileSystem.FileSystem): GitService => {
  const fs = nodeFsView(fileSystem, Effect.runPromise);

  const show = (repo: Repo, rev: string, path: string): Effect.Effect<Uint8Array, GitError> =>
    Effect.gen(function* () {
      const filepath = yield* relativeOrRefuse(repo, path);
      // A rev may be a ref name ("HEAD", a branch) or an object id; readBlob
      // only takes an id, so resolve first and fall back to the literal rev.
      const oid = yield* Effect.orElseSucceed(
        attempt("Conflict", () => git.resolveRef({ fs, dir: repo.root, ref: rev })),
        () => rev,
      );
      const blob = yield* attempt("Conflict", () =>
        git.readBlob({ fs, dir: repo.root, oid, filepath }),
      );
      return blob.blob;
    });

  const log = (repo: Repo, path?: string): Effect.Effect<readonly Commit[], GitError> =>
    Effect.gen(function* () {
      const filepath = path === undefined ? undefined : yield* relativeOrRefuse(repo, path);
      const entries = yield* attempt("Io", () =>
        git.log(filepath === undefined ? { fs, dir: repo.root } : { fs, dir: repo.root, filepath }),
      );
      return entries.map(commitOf);
    });

  return {
    open: (root) =>
      Effect.gen(function* () {
        const present = yield* Effect.orElseSucceed(
          Effect.mapError(fileSystem.exists(`${root}/.git`), (error) => failed("Io", error)),
          () => false,
        );
        if (!present) {
          return yield* Effect.fail(new GitError({ reason: "NotARepository", description: root }));
        }
        return { root } satisfies Repo;
      }),

    // isomorphic-git's init leaves an existing repository alone, so this is
    // the "open or create" the project flow wants.
    init: (root) =>
      Effect.as(
        attempt("Io", () => git.init({ fs, dir: root, defaultBranch: "main" })),
        { root } satisfies Repo,
      ),

    status: (repo) =>
      Effect.map(
        attempt("Io", () => git.statusMatrix({ fs, dir: repo.root })),
        (rows): Status => ({
          changed: rows.flatMap(([path, head, workdir, stage]) => {
            const kind = changeKindOf(head, workdir, stage);
            return kind === null ? [] : [{ path, kind }];
          }),
        }),
      ),

    commit: (
      repo: Repo,
      receipts: readonly SaveReceiptLike[],
      message: string,
      author: Author,
    ): Effect.Effect<CommitId, GitError> =>
      Effect.gen(function* () {
        if (receipts.length === 0) {
          return yield* refuse("nothing to commit: Save produced no receipts");
        }
        // The receipts rule: stage exactly what Save wrote, one path at a
        // time, so a file nobody saved cannot ride along in the commit.
        for (const receipt of receipts) {
          const filepath = yield* relativeOrRefuse(repo, receipt.path);
          yield* attempt("Io", () => git.add({ fs, dir: repo.root, filepath }));
        }
        return yield* attempt("Io", () => git.commit({ fs, dir: repo.root, message, author }));
      }),

    log,

    show,

    previousVersions: (repo, path) =>
      Effect.map(log(repo, path), (commits): readonly Version[] =>
        commits.map((commit) => ({ commit, bytes: () => show(repo, commit.id, path) })),
      ),
  };
};

export const WebGitLive: Layer.Layer<Git, never, FileSystem.FileSystem> = Layer.effect(
  Git,
  Effect.map(FileSystem.FileSystem, makeWebGit),
);
