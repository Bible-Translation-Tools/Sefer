/**
 * The Remote port (slice 26): the four online jobs a translator approves
 * explicitly — attach a repository to a URL, fetch, pull, push — plus
 * publishing a project somewhere it did not exist. Sefer is local-first, so
 * nothing here ever runs as a side effect of editing; every method is a job
 * someone asked for, and `progress()` exists so a long transfer can be shown
 * and cancelled rather than appearing to hang.
 *
 * Only the port and a refusing implementation live here; the hosts answer it
 * (`src/platform/web/remote.ts`, `src/platform/tauri`), and `./gitea.ts` is
 * the account half — signing in and finding a repository to attach to.
 */
import { Context, Data, Effect, Layer, Option, Stream } from "effect";

import type { Repo } from "../git/git";

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

export class RemoteError extends Data.TaggedError("RemoteError")<{
  readonly reason: RemoteFailureReason;
  readonly description?: string | undefined;
}> {}

/**
 * The shape of a credential Remote needs, declared structurally so the port
 * does not depend on the host `Credentials` service. Composition supplies the
 * lookup; nothing here reads or stores a token.
 */
export interface CredentialLike {
  readonly username: string;
  readonly token: string;
}

/** `Credentials.get(remote)` seen as a plain port. */
export type CredentialLookup = (
  remote: string,
) => Effect.Effect<Option.Option<CredentialLike>, never>;

export interface RemoteService {
  /** Records `url` as the repository's origin. Does not transfer anything. */
  readonly attach: (repo: Repo, url: string) => Effect.Effect<void, RemoteError>;
  /**
   * The URL `attach` recorded, or `None` when this project has none.
   *
   * `attach`'s read counterpart, and the first question the sync surface asks:
   * a project with no origin is `detached`, and that is a state to explain
   * rather than a transfer to attempt. `None` rather than a failure, because
   * "not attached yet" is the ordinary state of a project someone just made.
   */
  readonly origin: (repo: Repo) => Effect.Effect<Option.Option<string>, RemoteError>;
  readonly fetch: (repo: Repo) => Effect.Effect<Progress, RemoteError>;
  readonly pull: (repo: Repo) => Effect.Effect<Progress, RemoteError>;
  readonly push: (repo: Repo) => Effect.Effect<Progress, RemoteError>;
  /** Creates the project on `target` and pushes it there for the first time. */
  readonly publish: (repo: Repo, target: string) => Effect.Effect<void, RemoteError>;
  /** Progress for whatever transfer is running; empty when none is. */
  readonly progress: () => Stream.Stream<Progress>;
}

export class Remote extends Context.Service<Remote, RemoteService>()("Remote") {}

// Loud, typed refusal — never a silent success that would let a sync surface
// claim a project is up to date with a remote it never reached.
const unavailable = <A>(): Effect.Effect<A, RemoteError> =>
  Effect.fail(
    new RemoteError({
      reason: "Unavailable",
      description: "RemoteUnavailableLive: no remote transport is wired yet",
    }),
  );

/**
 * The refusing implementation, for a host with no transport at all.
 *
 * It is no longer the only one — `WebRemoteLive` (`src/platform/web/remote.ts`)
 * answers this port with isomorphic-git through a CORS proxy, and desktop
 * answers it with git2 behind Tauri commands. This Layer stays because a
 * composition that has neither must still build, and it must say so rather
 * than let a sync surface claim a project is up to date with a remote it
 * never reached.
 */
export const RemoteUnavailableLive: Layer.Layer<Remote> = Layer.succeed(Remote, {
  attach: () => unavailable(),
  // `None`, not a refusal: nothing was ever attached, which is true.
  origin: () => Effect.succeed(Option.none()),
  fetch: () => unavailable(),
  pull: () => unavailable(),
  push: () => unavailable(),
  publish: () => unavailable(),
  progress: () => Stream.empty,
} satisfies RemoteService);
