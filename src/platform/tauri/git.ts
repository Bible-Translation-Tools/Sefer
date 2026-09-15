/**
 * The desktop answer to the `Git` port: a thin adapter over the git2 commands
 * in `src-tauri/src/git.rs`.
 *
 * The decision (2026-09-06) is native git on desktop rather than
 * isomorphic-git: real performance on a project with a full New Testament of
 * history, and one implementation of merge and packfile behaviour instead of
 * two. The Web host keeps isomorphic-git because a browser has no alternative.
 *
 * Everything here is translation, not policy. The one rule this file enforces
 * is the receipts rule — a receipt path becomes repository-relative through
 * core's `repositoryPath` or it is `Refused` — and Rust re-checks it, because
 * this process can write anywhere the user can.
 *
 * Every member of the port is answered; nothing here refuses by name any more.
 * `src/core/git/contract.ts` is the spec, and it cannot be run against this
 * Layer from Node — `invoke` needs a Tauri runtime — so the same case, plus one
 * per command, lives as `#[cfg(test)] mod tests` in `src-tauri/src/git.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import { Effect, Layer, Option } from "effect";

import {
  Git,
  GitError,
  repositoryPath,
  type ChangedPath,
  type Commit,
  type CommitId,
  type GitFailureReason,
  type GitService,
  type Repo,
  type Status,
  type Version,
} from "../../core/git/git";

/** The wire shape of `git.rs`'s `GitCommit`. */
interface WireCommit {
  readonly id: string;
  readonly message: string;
  readonly author_name: string;
  readonly author_email: string;
  readonly at: number;
}

interface WireChangedPath {
  readonly path: string;
  readonly kind: string;
}

/**
 * The Rust side prefixes every error with a stable reason name (see
 * `src-tauri/src/errors.rs`), precisely so this function never has to read
 * libgit2 prose. An unrecognised prefix is `Io`: a new failure should degrade
 * to "something went wrong" rather than to a reason it is not.
 */
const REASONS: Readonly<Record<string, GitFailureReason>> = {
  NotARepository: "NotARepository",
  Io: "Io",
  Conflict: "Conflict",
  Refused: "Refused",
  // The transport reasons only Remote distinguishes collapse into Io here:
  // Git's port does not name them, and pretending otherwise would invent a
  // reason the caller cannot act on.
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

const refuse = (description: string): Effect.Effect<never, GitError> =>
  Effect.fail(new GitError({ reason: "Refused", description }));

/** Repository-relative or nothing — the receipts rule, in one place. */
const relativeOrRefuse = (repo: Repo, path: string): Effect.Effect<string, GitError> =>
  Option.match(repositoryPath(repo.root, path), {
    onNone: () => refuse(`path is outside the repository root: ${path}`),
    onSome: Effect.succeed,
  });

const commitOf = (wire: WireCommit): Commit => ({
  id: wire.id,
  message: wire.message,
  author: { name: wire.author_name, email: wire.author_email },
  at: wire.at,
});

/** Unknown kinds are reported as `modified`, the least surprising claim. */
const changeKindOf = (kind: string): ChangedPath["kind"] =>
  kind === "added" || kind === "deleted" || kind === "untracked" ? kind : "modified";

const show = (repo: Repo, rev: string, path: string): Effect.Effect<Uint8Array, GitError> =>
  Effect.gen(function* () {
    const relative = yield* relativeOrRefuse(repo, path);
    // Tauri serialises `Vec<u8>` as a JSON number array; this is the
    // history-view path (one file, on demand), never the editing path.
    const bytes = yield* call<readonly number[]>("git_show", {
      root: repo.root,
      rev,
      path: relative,
    });
    return new Uint8Array(bytes);
  });

export const TauriGitLive: Layer.Layer<Git> = Layer.succeed(Git, {
  open: (root) => Effect.as(call<void>("git_open", { root }), { root }),
  init: (root) => Effect.as(call<void>("git_init", { root }), { root }),

  status: (repo) =>
    Effect.map(
      call<readonly WireChangedPath[]>("git_status", { root: repo.root }),
      (changed): Status => ({
        changed: changed.map((entry) => ({ path: entry.path, kind: changeKindOf(entry.kind) })),
      }),
    ),

  commit: (repo, receipts, message, author) =>
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
      });
    }),

  log: (repo, path) =>
    Effect.gen(function* () {
      const relative = path === undefined ? null : yield* relativeOrRefuse(repo, path);
      const entries = yield* call<readonly WireCommit[]>("git_log", {
        root: repo.root,
        path: relative,
      });
      return entries.map(commitOf);
    }),

  /**
   * The four sync reads. None of them touches a file: after a fetch the
   * cloud's commits are already in the object database, so the whole
   * comparison — how far ahead, how far behind, which books would change — is
   * worked out before a byte of the work tree moves.
   *
   * `Refused` is gone from all four; `git.rs` exports the matching commands
   * and `cargo test` holds them to the same answers the Web layer gives.
   */
  logFrom: (repo, ref) =>
    Effect.map(
      call<readonly WireCommit[]>("git_log_from", { root: repo.root, rev: ref }),
      (entries) => entries.map(commitOf),
    ),

  // `None` is an ANSWER: a project attached to a repository nobody has pushed
  // to yet has no tracking ref, and that is the ordinary unpublished state.
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

  show,

  previousVersions: (repo, path) =>
    Effect.gen(function* () {
      const relative = yield* relativeOrRefuse(repo, path);
      const entries = yield* call<readonly WireCommit[]>("git_previous_versions", {
        root: repo.root,
        path: relative,
      });
      // Bytes stay deferred: a per-book history is long and only the version
      // someone opens is worth reading out of the object database.
      return entries.map(
        (wire): Version => ({
          commit: commitOf(wire),
          bytes: () => show(repo, wire.id, relative),
        }),
      );
    }),
} satisfies GitService);
