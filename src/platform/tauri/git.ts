/**
 * The desktop answer to the `Git` port — not yet wired.
 *
 * TODO(seam): the owner's decision (2026-09-06) is git2 in Rust behind Tauri
 * commands, not isomorphic-git, on desktop: real git performance on large
 * projects and one implementation of merge and packfile behaviour. The shape
 * this file will take:
 *
 *   - `src-tauri` exposes one command per port method (`git_open`, `git_init`,
 *     `git_status`, `git_commit`, `git_log`, `git_show`), each taking the work
 *     tree root and returning a serialisable mirror of the port's types.
 *   - `commit` receives the receipt paths and stages exactly those, so the
 *     receipts rule lives in Rust too rather than being re-derived here.
 *   - this module becomes a thin `invoke` adapter that maps a rejected command
 *     to `GitError`; Specta generates the command bindings so the boundary
 *     types are checked rather than hand-written.
 *
 * Until then every method fails loudly with `Refused`. `@tauri-apps/api` is
 * deliberately not imported: the stub must not make the dependency look
 * needed before the commands exist.
 */
import { Effect, Layer } from "effect";

import { Git, GitError, type GitService } from "../../core/git/git";

const refused = <A>(): Effect.Effect<A, GitError> =>
  Effect.fail(
    new GitError({
      reason: "Refused",
      description: "TauriGitLive: git2 commands are not wired yet",
    }),
  );

export const TauriGitLive: Layer.Layer<Git> = Layer.succeed(Git, {
  open: () => refused(),
  init: () => refused(),
  status: () => refused(),
  commit: () => refused(),
  log: () => refused(),
  show: () => refused(),
  previousVersions: () => refused(),
} satisfies GitService);
