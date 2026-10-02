/**
 * The Web answer to the `Git` port: isomorphic-git driven over the Effect
 * `FileSystem` through `nodeFsView`, so the same repository the OPFS layer
 * stores is the one Git reads. This file is the only place in the Web host
 * that knows isomorphic-git exists; core sees the port.
 */
import { Buffer } from "buffer";

import { Effect, FileSystem, Layer, Option } from "effect";
import git from "isomorphic-git";

import { nodeFsView } from "#core/fileSystem/nodeView";
import {
  DEFAULT_BRANCH,
  type Author,
  type ChangedPath,
  type Commit,
  type CommitId,
  type CommitOptions,
  composedTimeline,
  Git,
  GitError,
  type GitFailureReason,
  type GitService,
  type Repo,
  relativeOrRefuse,
  type SaveReceiptLike,
  sharedFrom,
  type Status,
  type Version,
} from "#core/git/git";
import {
  bookHistoryFrom,
  entryIn,
  isIndexedBook,
  reachableFrom,
  type BookVersion,
} from "#core/history/bookIndex";
import { Observability } from "#core/observability";

import { ensureBookIndex } from "./history/store";

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

const makeWebGit = (
  fileSystem: FileSystem.FileSystem,
  observability: Option.Option<typeof Observability.Service>,
): GitService => {
  const fs = nodeFsView(fileSystem, Effect.runPromise);

  /**
   * A file's bytes at a commit, found through RAW trees: isomorphic-git's
   * `readBlob({ filepath })` parses every tree on the way and throws
   * `UnsafeFilepathError` on a name git itself accepts (en_ulb's 2018 root
   * tree has `00-About_the_ULB\ULB-Intro.md`), so an old version of Genesis
   * could not be read because of a file nobody asked for.
   */
  const show = (repo: Repo, rev: string, path: string): Effect.Effect<Uint8Array, GitError> =>
    Effect.gen(function* () {
      const filepath = yield* relativeOrRefuse(repo, path);
      // A rev may be a ref name ("HEAD", a branch) or an object id.
      const oid = yield* Effect.orElseSucceed(
        attempt("Conflict", () => git.resolveRef({ fs, dir: repo.root, ref: rev })),
        () => rev,
      );
      return yield* attempt("Conflict", async () => {
        const cache = {};
        const { commit } = await git.readCommit({ fs, dir: repo.root, oid, cache });
        let at = commit.tree;
        const parts = filepath.split("/").filter((part) => part !== "");
        for (const [index, part] of parts.entries()) {
          const { object } = await git.readObject({
            fs,
            dir: repo.root,
            oid: at,
            format: "content",
            cache,
          });
          const entry = object instanceof Uint8Array ? entryIn(object, part) : undefined;
          if (entry === undefined || entry.tree !== index < parts.length - 1)
            throw new Error(`${filepath} is not in ${oid}`);
          at = entry.id;
        }
        return (await git.readBlob({ fs, dir: repo.root, oid: at, cache })).blob;
      });
    });

  /**
   * A top-level book's history, from the book-change index: git's default
   * simplification over parent links, with no tree parsed — so neither a
   * name git accepts nor a long history can stop it — and current with HEAD,
   * extending only what is new.
   */
  /** The book-change index, current with HEAD: read, or extended, once per ask. */
  const indexOf = (repo: Repo) =>
    Effect.gen(function* () {
      const started = performance.now();
      const ensured = yield* attempt("Io", () => ensureBookIndex(fs, repo.root));
      Option.map(observability, (held) =>
        held.note(
          "history.index",
          ensured.how === "held" || ensured.how === "stored" ? "consumed" : "rewrote",
          ensured.how,
          {
            "index.commits": ensured.index.commits.length,
            "index.read": ensured.report?.read ?? 0,
            "index.reused": ensured.report?.reused ?? 0,
            "index.ms": Math.round(performance.now() - started),
          },
        ),
      );
      return ensured.index;
    });
  const bookHistory = (repo: Repo, filepath: string) =>
    Effect.map(indexOf(repo), (index) => bookHistoryFrom(index, filepath));

  /** A version from the index: its blob id is known, so its bytes are one read by id. */
  const versionFrom =
    (repo: Repo, filepath: string) =>
    (version: BookVersion): Version => ({
      commit: asCommit(version),
      bytes: () =>
        version.blob === null
          ? Effect.fail(
              new GitError({
                reason: "Conflict",
                description: `${filepath} was removed in ${version.commit.id}`,
              }),
            )
          : attempt("Conflict", async () => {
              const blob = version.blob ?? "";
              return (await git.readBlob({ fs, dir: repo.root, oid: blob })).blob;
            }),
    });

  const asCommit = (version: {
    readonly commit: {
      readonly id: string;
      readonly message: string;
      readonly author: string;
      readonly email: string;
      readonly at: number;
    };
  }): Commit => ({
    id: version.commit.id,
    message: version.commit.message,
    author: { name: version.commit.author, email: version.commit.email },
    at: version.commit.at,
  });

  const log = (repo: Repo, path?: string): Effect.Effect<readonly Commit[], GitError> =>
    Effect.gen(function* () {
      const filepath = path === undefined ? undefined : yield* relativeOrRefuse(repo, path);
      if (filepath !== undefined && isIndexedBook(filepath))
        return (yield* bookHistory(repo, filepath)).map(asCommit);
      const entries = yield* attempt("Io", () =>
        git.log(filepath === undefined ? { fs, dir: repo.root } : { fs, dir: repo.root, filepath }),
      );
      return entries.map(commitOf);
    });

  const service: Omit<GitService, "timeline"> = {
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
        attempt("Io", () => git.init({ fs, dir: root, defaultBranch: DEFAULT_BRANCH })),
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
      options?: CommitOptions,
    ): Effect.Effect<CommitId, GitError> =>
      Effect.gen(function* () {
        const also = options?.alsoParents ?? [];
        // A join records something true with no file of its own: the other
        // history's commits changed nothing this side lacks. Anything else
        // with no receipts is a bug upstream, and an empty commit would say so
        // in the history a translator reads.
        if (receipts.length === 0 && also.length === 0) {
          return yield* refuse("nothing to commit: Save produced no receipts");
        }
        // The receipts rule: stage exactly what Save wrote, one path at a
        // time, so a file nobody saved cannot ride along in the commit.
        const staged: string[] = [];
        for (const receipt of receipts) staged.push(yield* relativeOrRefuse(repo, receipt.path));
        // A commit that fails must not leave the index holding paths no commit
        // records, or the next ordinary commit would carry them: every path
        // staged here goes back to HEAD's on the way out.
        const unstage = Effect.forEach(staged, (filepath) =>
          Effect.ignore(attempt("Io", () => git.resetIndex({ fs, dir: repo.root, filepath }))),
        );
        return yield* Effect.onError(
          Effect.gen(function* () {
            for (const filepath of staged)
              yield* attempt("Io", () => git.add({ fs, dir: repo.root, filepath }));
            // isomorphic-git's `parent` REPLACES HEAD as the parent list, so a
            // decision commit names HEAD first itself.
            const parent =
              also.length === 0
                ? undefined
                : [
                    yield* attempt("Conflict", () =>
                      git.resolveRef({ fs, dir: repo.root, ref: "HEAD" }),
                    ),
                    ...also,
                  ];
            return yield* attempt("Io", () =>
              git.commit({
                fs,
                dir: repo.root,
                message,
                author,
                ...(parent === undefined ? {} : { parent }),
              }),
            );
          }),
          () => unstage,
        );
      }),

    mergeBase: (repo, a, b) =>
      Effect.gen(function* () {
        const [left, right] = yield* Effect.all([
          attempt("Conflict", () => git.resolveRef({ fs, dir: repo.root, ref: a })),
          attempt("Conflict", () => git.resolveRef({ fs, dir: repo.root, ref: b })),
        ]);
        const found = yield* attempt("Conflict", () =>
          git.findMergeBase({ fs, dir: repo.root, oids: [left, right] }),
        );
        const first: unknown = found[0];
        return typeof first === "string" ? Option.some(first) : Option.none();
      }),

    log,

    logFrom: (repo, ref) =>
      Effect.map(
        attempt("Conflict", () => git.log({ fs, dir: repo.root, ref })),
        (entries) => entries.map(commitOf),
      ),

    // isomorphic-git throws `NotFoundError` for a ref that is not there, and
    // "the cloud has nothing on this branch yet" is an answer rather than a
    // fault — hence Option, and hence swallowing the throw here and only here.
    resolve: (repo, ref) =>
      Effect.orElseSucceed(
        Effect.map(
          attempt("Conflict", () => git.resolveRef({ fs, dir: repo.root, ref })),
          Option.some<CommitId>,
        ),
        Option.none<CommitId>,
      ),

    // git writes `.git/shallow` for a clone with a depth, and removes it once
    // the history is whole.
    shallow: (repo) =>
      attempt("Io", () =>
        fs
          .readFile(`${repo.root}/.git/shallow`, "utf8")
          .then((text) => String(text).trim() !== "")
          .catch(() => false),
      ),

    branch: (repo) =>
      Effect.map(
        attempt("Io", () => git.currentBranch({ fs, dir: repo.root, fullname: false })),
        (name) => (typeof name === "string" ? Option.some(name) : Option.none()),
      ),

    changedPathsBetween: (repo, from, to) =>
      attempt("Conflict", () =>
        git.walk({
          fs,
          dir: repo.root,
          trees: [git.TREE({ ref: from }), git.TREE({ ref: to })],
          // `git.walk`'s map runs per entry with one side possibly absent. A
          // directory is not a change; two blobs with the same oid are not
          // either, and comparing oids is why this needs no blob reads.
          map: async (filepath, entries) => {
            if (filepath === ".") return;
            const before = entries?.[0] ?? null;
            const after = entries?.[1] ?? null;
            const beforeType = before === null ? undefined : await before.type();
            const afterType = after === null ? undefined : await after.type();
            if (beforeType === "tree" || afterType === "tree") return;
            if (before === null && after === null) return;
            if (before === null) return { path: filepath, kind: "added" } satisfies ChangedPath;
            if (after === null) return { path: filepath, kind: "deleted" } satisfies ChangedPath;
            const [beforeOid, afterOid] = await Promise.all([before.oid(), after.oid()]);
            return beforeOid === afterOid
              ? undefined
              : ({ path: filepath, kind: "modified" } satisfies ChangedPath);
          },
        }),
      ),

    show,

    // A book's versions carry their blob ids from the index, so reading one is
    // one object read by id, with no tree walked at all.
    previousVersions: (repo, path) =>
      Effect.gen(function* () {
        const filepath = yield* relativeOrRefuse(repo, path);
        if (!isIndexedBook(filepath))
          return (yield* log(repo, path)).map((commit): Version => ({
            commit,
            bytes: () => show(repo, commit.id, path),
          }));
        return (yield* bookHistory(repo, filepath)).map(versionFrom(repo, filepath));
      }),
  };

  // History's timeline from ONE read of the index: its commits are HEAD's
  // log, newest first; each book's versions are a walk over them; and the
  // shared project's commits are what its tip reaches inside the index. A
  // repository the index cannot be built for (no HEAD yet) composes the
  // per-path calls instead.
  const timeline: GitService["timeline"] = (repo, paths, shared) =>
    Effect.gen(function* () {
      const built = yield* Effect.result(indexOf(repo));
      if (built._tag === "Failure") return yield* composedTimeline(service)(repo, paths, shared);
      const index = built.success;
      const versions = new Map<string, readonly Version[]>();
      for (const path of paths) {
        const filepath = yield* Effect.result(relativeOrRefuse(repo, path));
        if (filepath._tag === "Failure") continue;
        if (isIndexedBook(filepath.success))
          versions.set(
            path,
            bookHistoryFrom(index, filepath.success).map(versionFrom(repo, filepath.success)),
          );
        else {
          const found = yield* Effect.result(service.previousVersions(repo, path));
          if (found._tag === "Success") versions.set(path, found.success);
        }
      }
      let reached: ReadonlySet<string> | undefined;
      if (shared !== undefined) {
        const tip = yield* Effect.orElseSucceed(service.resolve(repo, shared), () =>
          Option.none<string>(),
        );
        reached = Option.isNone(tip) ? undefined : reachableFrom(index, tip.value);
        if (Option.isSome(tip) && reached === undefined)
          reached = yield* sharedFrom(service, repo, shared);
      }
      return {
        commits: index.commits.map((commit) => asCommit({ commit })),
        versions,
        shared: reached,
      };
    });

  return { ...service, timeline };
};

export const WebGitLive: Layer.Layer<Git, never, FileSystem.FileSystem> = Layer.effect(
  Git,
  Effect.gen(function* () {
    return makeWebGit(yield* FileSystem.FileSystem, yield* Effect.serviceOption(Observability));
  }),
);
