import { invoke } from "@tauri-apps/api/core";
import { Effect, Layer, Option } from "effect";

import {
  composedTimeline,
  Git,
  GitError,
  relativeOrRefuse,
  type ChangedPath,
  type Commit,
  type CommitId,
  type GitFailureReason,
  type GitService,
  type Repo,
  type Status,
  type Version,
  type WalkedCommit,
} from "#core/git/git";

interface WireCommit {
  readonly id: string;
  readonly message: string;
  readonly author_name: string;
  readonly author_email: string;
  readonly at: number;
}

type WireWalkedCommit = WalkedCommit;

interface WireChangedPath {
  readonly path: string;
  readonly kind: string;
}

const REASONS: Readonly<Record<string, GitFailureReason>> = {
  NotARepository: "NotARepository",
  Io: "Io",
  Conflict: "Conflict",
  Refused: "Refused",
  AuthFailed: "Io",
  Offline: "Io",
  Rejected: "Io",
};

const failureOf = (cause: unknown): GitError => {
  const message = cause instanceof Error ? cause.message : String(cause);
  const separator = message.indexOf(": ");
  const prefix = separator === -1 ? "" : message.slice(0, separator);
  return new GitError({
    reason: REASONS[prefix] ?? "Io",
    description: separator === -1 ? message : message.slice(separator + 2),
  });
};

const call = <A>(command: string, args: Record<string, unknown>): Effect.Effect<A, GitError> =>
  Effect.tryPromise({ try: () => invoke<A>(command, args), catch: failureOf });

const commitOf = (wire: WireCommit): Commit => ({
  id: wire.id,
  message: wire.message,
  author: { name: wire.author_name, email: wire.author_email },
  at: wire.at,
});

const changeKindOf = (kind: string): ChangedPath["kind"] =>
  kind === "added" || kind === "deleted" || kind === "untracked" ? kind : "modified";

const show = (repo: Repo, rev: string, path: string): Effect.Effect<Uint8Array, GitError> =>
  Effect.gen(function* () {
    const relative = yield* relativeOrRefuse(repo, path);
    const bytes = yield* call<readonly number[]>("git_show", {
      root: repo.root,
      rev,
      path: relative,
    });
    return new Uint8Array(bytes);
  });

const tauriGit = {
  open: (root) => Effect.as(call<void>("git_open", { root }), { root }),
  init: (root) => Effect.as(call<void>("git_init", { root }), { root }),

  status: (repo) =>
    Effect.map(
      call<readonly WireChangedPath[]>("git_status", { root: repo.root }),
      (changed): Status => ({
        changed: changed.map((entry) => ({ path: entry.path, kind: changeKindOf(entry.kind) })),
      }),
    ),

  commit: (repo, receipts, message, author, options) =>
    Effect.gen(function* () {
      const paths = yield* Effect.forEach(receipts, (receipt) =>
        relativeOrRefuse(repo, receipt.path),
      );
      return yield* call<CommitId>("git_commit", {
        root: repo.root,
        paths,
        message,
        authorName: author.name,
        authorEmail: author.email,
        alsoParents: options?.alsoParents ?? null,
      });
    }),

  mergeBase: (repo, a, b) =>
    Effect.map(
      call<CommitId | null>("git_merge_base", { root: repo.root, a, b }),
      Option.fromNullishOr,
    ),

  log: (repo, path) =>
    Effect.gen(function* () {
      const relative = path === undefined ? null : yield* relativeOrRefuse(repo, path);
      const entries = yield* call<readonly WireCommit[]>("git_log", {
        root: repo.root,
        path: relative,
      });
      return entries.map(commitOf);
    }),

  logFrom: (repo, ref) =>
    Effect.map(
      call<readonly WireCommit[]>("git_log_from", { root: repo.root, rev: ref }),
      (entries) => entries.map(commitOf),
    ),

  resolve: (repo, ref) =>
    Effect.map(
      call<string | null>("git_resolve_ref", { root: repo.root, rev: ref }),
      Option.fromNullishOr,
    ),

  branch: (repo) =>
    Effect.map(
      call<string | null>("git_current_branch", { root: repo.root }),
      Option.fromNullishOr,
    ),

  shallow: (repo) => call<boolean>("git_is_shallow", { root: repo.root }),

  changedPathsBetween: (repo, from, to) =>
    Effect.map(
      call<readonly WireChangedPath[]>("git_changed_paths_between", {
        root: repo.root,
        from,
        to,
      }),
      (changed): readonly ChangedPath[] =>
        changed.map((entry) => ({ path: entry.path, kind: changeKindOf(entry.kind) })),
    ),

  walk: (repo) => call<readonly WireWalkedCommit[]>("git_walk", { root: repo.root }),

  blobs: (repo, ids) =>
    Effect.map(
      call<readonly (readonly number[])[]>("git_blobs", { root: repo.root, ids }),
      (bytes): ReadonlyMap<string, Uint8Array> =>
        new Map(ids.map((id, index) => [id, new Uint8Array(bytes[index] ?? [])])),
    ),

  show,

  previousVersions: (repo, path) =>
    Effect.gen(function* () {
      const relative = yield* relativeOrRefuse(repo, path);
      const entries = yield* call<readonly WireCommit[]>("git_previous_versions", {
        root: repo.root,
        path: relative,
      });
      return entries.map((wire): Version => ({
        commit: commitOf(wire),
        bytes: () => show(repo, wire.id, relative),
      }));
    }),
} satisfies Omit<GitService, "timeline">;

export const TauriGitLive: Layer.Layer<Git> = Layer.succeed(Git, {
  ...tauriGit,
  timeline: composedTimeline(tauriGit),
} satisfies GitService);
