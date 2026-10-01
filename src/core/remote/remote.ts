/**
 * The Remote port: the online jobs a translator approves explicitly — clone
 * a repository into a new folder, attach one to a URL, fetch, fast-forward, push —
 * plus publishing a project somewhere it did not exist. Sefer is local-first, so
 * nothing here ever runs as a side effect of editing; every method is a job
 * someone asked for, and `progress()` exists so a long transfer can be shown
 * and cancelled rather than appearing to hang.
 *
 * Only the port and a refusing implementation live here; the hosts answer it
 * (`src/platform/web/remote.ts`, `src/platform/tauri`), and `./gitea.ts` is
 * the account half — signing in and finding a repository to attach to.
 */
import { Context, Data, Effect, Option, Stream } from "effect";

import type { Repo } from "../git/git";
import type { Verdict } from "../observability";

/**
 * Transfer progress as the host reports it. `total` is absent until the far
 * side has told us how much there is, which is most of a fetch's first phase.
 */
export interface Progress {
  readonly phase: string;
  readonly loaded: number;
  readonly total?: number | undefined;
}

/**
 * `Unavailable` — this build has no remote transport at all.
 * `Unauthorized` — no credential for the remote, or it was rejected.
 * `Network` — the transport failed: offline, DNS, CORS, a dead proxy.
 * `Rejected` — the far side refused the request (non-fast-forward, no access).
 * A sync surface must tell these four apart: only one of them is worth
 * retrying unchanged.
 */
export type RemoteFailureReason = "Unavailable" | "Unauthorized" | "Network" | "Rejected";

/**
 * How a transfer that failed for `reason` is recorded.
 *
 * The Remote port is one of the outside boundaries, so it is where the world
 * saying no becomes `unavailable` rather than the alarm: no transport, or a
 * transport that did not answer. A credential or a far side that refused is
 * a rule holding, `refused`. No reason at all means the failure did not come
 * from the port, and that stays `failed`.
 */
export const remoteVerdict = (reason: RemoteFailureReason | undefined): Verdict => {
  if (reason === "Unavailable" || reason === "Network") return "unavailable";
  if (reason === "Unauthorized" || reason === "Rejected") return "refused";
  return "failed";
};

export class RemoteError extends Data.TaggedError("RemoteError")<{
  readonly reason: RemoteFailureReason;
  readonly description?: string | undefined;
}> {}

/**
 * What a URL is, asked of the server without transferring anything but its
 * refs: the branch its HEAD names and where that branch points. `empty` is a
 * repository with no branch yet — somewhere a first send can go.
 */
export interface Probe {
  readonly defaultBranch: Option.Option<string>;
  readonly head: Option.Option<string>;
  readonly empty: boolean;
}

/**
 * How much history a clone takes.
 *
 * - `latest` — the newest version only (depth 1): a tenth of en_ulb's
 *   download, and all that sync ever needs, because every commit either side
 *   makes afterwards sits on top of it. Older history comes later, by
 *   `deepen`, if History is ever opened. What a reference text wants.
 * - `all` — the whole history, now.
 *
 * Left unsaid, each host chooses: the Web takes `latest`, because a browser
 * on a low-end device or a slow connection is where a full clone hurts;
 * desktop takes `all`.
 */
export type CloneHistory = "latest" | "all";

export interface CloneOptions {
  readonly history?: CloneHistory;
}

export interface RemoteService {
  /**
   * A fresh clone of `url` into `into`, with `origin` recorded as `attach`
   * would record it. The branch checked out is the one the SERVER names as
   * its HEAD, so a repository on `master` arrives on `master`; nothing here
   * assumes `main`. Anonymous unless a credential is held for the host.
   *
   * Not atomic: a failed clone may leave a partial folder behind, and whether
   * to delete it is the caller's decision about the user's disk.
   */
  readonly clone: (
    url: string,
    into: string,
    options?: CloneOptions,
  ) => Effect.Effect<{ readonly repo: Repo; readonly progress: Progress }, RemoteError>;
  /** Records `url` as the repository's origin. Does not transfer anything. */
  readonly attach: (repo: Repo, url: string) => Effect.Effect<void, RemoteError>;
  /** `attach` for a remote other than `origin` — somewhere else to send to. */
  readonly attachAs: (repo: Repo, name: string, url: string) => Effect.Effect<void, RemoteError>;
  /** The URL recorded for the remote `name`, or `None`. */
  readonly urlOf: (repo: Repo, name: string) => Effect.Effect<Option.Option<string>, RemoteError>;
  /**
   * Fetches one named ref from `origin` — one no branch refspec covers — into
   * the local ref `into`, and answers the commit it names. Nothing in the work
   * tree moves.
   */
  readonly fetchRef: (repo: Repo, from: string, into: string) => Effect.Effect<string, RemoteError>;
  /**
   * The URL `attach` recorded, or `None` when this project has none.
   *
   * `attach`'s read counterpart, and the first question the sync surface asks:
   * a project with no origin is `detached`, and that is a state to explain
   * rather than a transfer to attempt. `None` rather than a failure, because
   * "not attached yet" is the ordinary state of a project someone just made.
   */
  readonly origin: (repo: Repo) => Effect.Effect<Option.Option<string>, RemoteError>;
  /**
   * Asks `url` what it is without cloning it: the cheapest "are we up to
   * date?", and the answer a URL field shows before anything is attached.
   * Anonymous unless a credential is held for the host.
   */
  readonly probe: (url: string) => Effect.Effect<Probe, RemoteError>;
  readonly fetch: (repo: Repo) => Effect.Effect<Progress, RemoteError>;
  /**
   * Fetches the history a `latest` clone left on the server, all of it, for
   * the current branch. Moves no branch and no file; a repository with its
   * whole history already gets nothing.
   */
  readonly deepen: (repo: Repo) => Effect.Effect<Progress, RemoteError>;
  /**
   * Moves the checked-out branch forward to `to` and brings the work tree
   * with it — only ever forward: `Rejected` unless `to` descends from HEAD.
   *
   * The checkout is SAFE, never forced: a file with changes no commit holds
   * is not overwritten, and the move is refused whole rather than half made.
   * Only files that differ between the two commits are written.
   */
  readonly fastForward: (repo: Repo, to: string) => Effect.Effect<void, RemoteError>;
  /** Sends the checked-out branch to `to`, `origin` unless named. */
  readonly push: (repo: Repo, to?: string) => Effect.Effect<Progress, RemoteError>;
  /** Creates the project on `target` and pushes it there for the first time. */
  readonly publish: (repo: Repo, target: string) => Effect.Effect<void, RemoteError>;
  /**
   * Throws away a half-finished merge: the work tree goes back to HEAD and the
   * merge state is cleared. This is what Resolve does.
   *
   * `Rejected` when nothing is in progress, deliberately — the operation is a
   * hard reset underneath, and running one on a clean repository would discard
   * a translator's unsaved morning rather than undoing a transfer.
   */
  readonly abortMerge: (repo: Repo) => Effect.Effect<void, RemoteError>;
  /** Progress for whatever transfer is running; empty when none is. */
  readonly progress: () => Stream.Stream<Progress>;
}

export class Remote extends Context.Service<Remote, RemoteService>()("Remote") {}
