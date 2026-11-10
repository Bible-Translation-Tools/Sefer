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
  type GitObject,
  type ObjectReader,
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

Object.assign(globalThis, { Buffer });

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const failed = (reason: GitFailureReason, error: unknown): GitError =>
  new GitError({ reason, description: describeError(error) });

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

  const show = (repo: Repo, rev: string, path: string): Effect.Effect<Uint8Array, GitError> =>
    Effect.gen(function* () {
      const filepath = yield* relativeOrRefuse(repo, path);
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

  const objectReader = (repo: Repo): ObjectReader => {
    const cache = {};
    return (ids) =>
      attempt("Io", async () => {
        const out = new Map<string, GitObject>();
        await Promise.all(
          [...new Set(ids)].map(async (oid) => {
            try {
              const { type, object } = await git.readObject({
                fs,
                dir: repo.root,
                oid,
                format: "content",
                cache,
              });
              if (
                (type === "commit" || type === "tree" || type === "blob") &&
                object instanceof Uint8Array
              )
                out.set(oid, { type, bytes: object });
            } catch {
              // Missing: the walk names what it could not find.
            }
          }),
        );
        return out;
      });
  };

  const service: Omit<GitService, "timeline"> = {
    objectReader,
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
        if (receipts.length === 0 && also.length === 0) {
          return yield* refuse("nothing to commit: Save produced no receipts");
        }
        const staged: string[] = [];
        for (const receipt of receipts) staged.push(yield* relativeOrRefuse(repo, receipt.path));
        const unstage = Effect.forEach(staged, (filepath) =>
          Effect.ignore(attempt("Io", () => git.resetIndex({ fs, dir: repo.root, filepath }))),
        );
        return yield* Effect.onError(
          Effect.gen(function* () {
            for (const filepath of staged)
              yield* attempt("Io", () => git.add({ fs, dir: repo.root, filepath }));
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

    resolve: (repo, ref) =>
      Effect.orElseSucceed(
        Effect.map(
          attempt("Conflict", () => git.resolveRef({ fs, dir: repo.root, ref })),
          Option.some<CommitId>,
        ),
        Option.none<CommitId>,
      ),

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
