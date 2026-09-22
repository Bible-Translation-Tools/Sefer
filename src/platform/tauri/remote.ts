/**
 * The desktop answer to the `Remote` port, over the git2 commands in
 * `src-tauri/src/git.rs`.
 *
 * The desktop half is the simple one: git2 speaks smart-HTTP directly and is
 * not a browser origin, so its endpoint (`VITE_SEFER_WACS_DESKTOP_URL`) is
 * normally Gitea itself and no proxy is in the picture at all. What
 * it shares with the Web half is the rules, and those are deliberately the
 * same on both hosts:
 *
 *  1. Nothing transfers as a side effect of editing. Every method here is a
 *     job someone asked for.
 *  2. The credential comes from the host `Credentials` service, keyed by the
 *     origin of the remote's URL — a token belongs to a Gitea instance, not to
 *     one repository. Tokens never reach a project file. Nobody signed in is
 *     an ANSWER, not a failure: WACS content is public, so fetch and pull run
 *     anonymously and only push insists on a credential.
 *  3. A pull fast-forwards or reports `Rejected`. Sefer does not merge USFM
 *     behind a translator's back; conflict markers inside scripture are worse
 *     than a question.
 *
 * `publish` needs the Gitea API to create the repository, which is the one
 * thing git2 cannot do, so it goes through the same `Gitea` service the Web
 * host uses.
 */
import { invoke } from "@tauri-apps/api/core";
import { Effect, Layer, Option, PubSub, Stream } from "effect";

import type { Repo } from "../../core/git/git";
import { Credentials, type CredentialsService } from "../../core/host/credentials";
import {
  Gitea,
  type GiteaError,
  type GiteaFailureReason,
  type GiteaService,
} from "../../core/remote/gitea";
import {
  Remote,
  RemoteError,
  type Progress,
  type RemoteFailureReason,
  type RemoteService,
} from "../../core/remote/remote";

/** The remote Sefer attaches and transfers; one per project, always. */
const ORIGIN = "origin";

/** How many progress events a slow reader may fall behind before losing some. */
const PROGRESS_DEPTH = 64;

export interface TauriRemoteOptions {
  /** `VITE_SEFER_GITEA_DESKTOP_HOST`; `null` disables publishing by name. */
  readonly endpoint: string | null;
}

/** The wire shape of `git.rs`'s `GitProgress`. */
interface WireProgress {
  readonly phase: string;
  readonly loaded: number;
  readonly total: number | null;
}

const fail = (reason: RemoteFailureReason, description: string): RemoteError =>
  new RemoteError({ reason, description });

/**
 * The Rust prefix vocabulary (`src-tauri/src/errors.rs`) as the four reasons a
 * sync surface can act on. `Conflict` — a diverged branch — is `Rejected`
 * because it has a specific remedy the person can carry out, and an
 * unrecognised prefix is `Rejected` too: the request did not happen, and we
 * will not claim a network cause we did not observe.
 */
const REASONS: Readonly<Record<string, RemoteFailureReason>> = {
  AuthFailed: "Unauthorized",
  Offline: "Network",
  Rejected: "Rejected",
  Conflict: "Rejected",
  NotARepository: "Unavailable",
  Refused: "Rejected",
  Io: "Rejected",
};

const classify = (cause: unknown): RemoteError => {
  const message = cause instanceof Error ? cause.message : String(cause);
  const separator = message.indexOf(": ");
  const prefix = separator === -1 ? "" : message.slice(0, separator);
  return fail(
    REASONS[prefix] ?? "Rejected",
    separator === -1 ? message : message.slice(separator + 2),
  );
};

const call = <A>(command: string, args: Record<string, unknown>): Effect.Effect<A, RemoteError> =>
  Effect.tryPromise({ try: () => invoke<A>(command, args), catch: classify });

/**
 * The origin of a remote URL — the `Credentials` key. The twin of
 * `hostOf` in `src/platform/web/remote.ts`; it is duplicated rather than
 * shared because importing that module would pull isomorphic-git into the
 * desktop bundle for six lines of URL parsing.
 */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

const progressOf = (wire: WireProgress): Progress => ({
  phase: wire.phase,
  loaded: wire.loaded,
  ...(wire.total === null ? {} : { total: wire.total }),
});

/** A `Gitea` call seen as a `Remote` one, so `publish` has one error type. */
const reasonOf = (reason: GiteaFailureReason): RemoteFailureReason => {
  switch (reason) {
    case "Unauthorized":
    case "OtpRequired":
      return "Unauthorized";
    case "Network":
      return "Network";
    default:
      return "Rejected";
  }
};

const fromGitea = <A>(effect: Effect.Effect<A, GiteaError>): Effect.Effect<A, RemoteError> =>
  Effect.mapError(effect, (error) =>
    fail(reasonOf(error.reason), error.description ?? error.reason),
  );

const makeTauriRemote = (
  options: TauriRemoteOptions,
  credentials: CredentialsService,
  gitea: GiteaService,
): Effect.Effect<RemoteService> =>
  Effect.gen(function* () {
    // Sliding, not unbounded: progress is a live readout. If nothing is
    // watching, the events are worthless, and they must never make a transfer
    // wait or let a long fetch grow the heap.
    const events = yield* PubSub.sliding<Progress>({ capacity: PROGRESS_DEPTH });

    const originUrl = (repo: Repo): Effect.Effect<string, RemoteError> =>
      Effect.flatMap(
        call<string | null>("git_remote_url", { root: repo.root, name: ORIGIN }),
        (url) =>
          url === null
            ? Effect.fail(fail("Unavailable", "this project has no remote attached yet"))
            : Effect.succeed(url),
      );

    /**
     * The credential for a URL's origin, or `None` when nobody has signed in.
     *
     * `None` is deliberately not an error. Browsing the catalogue and cloning
     * a public translation is how somebody gets started, and the Rust side
     * installs no credentials callback at all when this is absent — which is
     * what makes an anonymous fetch succeed rather than report a 401.
     */
    const credentialFor = (
      url: string,
    ): Effect.Effect<Option.Option<{ readonly username: string; readonly token: string }>> =>
      Effect.map(
        credentials.get(hostOf(url)),
        Option.map((credential) => ({ username: credential.username, token: credential.token })),
      );

    /**
     * The one shape all three transfers share: find the origin, look for a
     * credential, run the command, publish what it reported. git2 reports
     * progress through callbacks inside one blocking command, so what reaches
     * the stream is the transfer's final tally rather than a live trickle —
     * enough to show "done, N objects", not enough for a progress bar. A
     * live readout needs the Rust side to emit Tauri events; that is a
     * TODO(seam), not a reason to fake intermediate numbers here.
     */
    const transfer = (
      command: string,
      repo: Repo,
      auth: "required" | "optional",
    ): Effect.Effect<Progress, RemoteError> =>
      Effect.gen(function* () {
        const url = yield* originUrl(repo);
        const held = yield* credentialFor(url);
        // Push is the only transfer nobody can do anonymously, and refusing it
        // here rather than letting the server answer 401 is what turns "sign
        // in first" into advice instead of a status code.
        if (auth === "required" && Option.isNone(held)) {
          return yield* Effect.fail(
            fail("Unauthorized", `no credential for ${hostOf(url)}; sign in first`),
          );
        }
        const credential = Option.getOrNull(held);
        const wire = yield* call<WireProgress>(command, {
          root: repo.root,
          remote: ORIGIN,
          username: credential?.username ?? null,
          token: credential?.token ?? null,
        });
        const progress = progressOf(wire);
        yield* PubSub.publish(events, progress);
        return progress;
      });

    const attach = (repo: Repo, url: string): Effect.Effect<void, RemoteError> =>
      call<void>("git_ensure_remote", { root: repo.root, name: ORIGIN, url });

    /** `owner/name` or `name` on the configured host → the URL to attach. */
    const createOnGitea = (target: string): Effect.Effect<string, RemoteError> =>
      Effect.gen(function* () {
        const host = options.endpoint;
        if (host === null) {
          return yield* Effect.fail(
            fail("Unavailable", "this build has no WACS endpoint: set VITE_SEFER_WACS_DESKTOP_URL"),
          );
        }
        const parts = target.split("/");
        const name = parts[parts.length - 1] ?? target;
        const owner = parts.length > 1 ? parts[0] : undefined;
        // Only a fully qualified `owner/name` can be looked up; a bare name is
        // a request to create one under the signed-in user.
        if (owner !== undefined) {
          const existing = yield* fromGitea(gitea.getRepo(host, owner, name));
          if (Option.isSome(existing)) return existing.value.cloneUrl;
        }
        const created = yield* fromGitea(gitea.createRepo(host, { name }));
        return created.cloneUrl;
      });

    return {
      attach,
      // `git_remote_url` already answers `string | null`, so the read half of
      // attach costs desktop no new Rust.
      origin: (repo) =>
        Effect.map(
          call<string | null>("git_remote_url", { root: repo.root, name: ORIGIN }),
          Option.fromNullishOr,
        ),
      fetch: (repo) => transfer("git_fetch", repo, "optional"),
      pull: (repo) => transfer("git_pull", repo, "optional"),
      push: (repo) => transfer("git_push", repo, "required"),
      publish: (repo, target) =>
        Effect.gen(function* () {
          const url = target.startsWith("http") ? target : yield* createOnGitea(target);
          yield* attach(repo, url);
          yield* transfer("git_push", repo, "required");
        }),
      // The two local moves. No origin, no credential, no transport — git2
      // does the whole thing, and the refusals (a branch that is not checked
      // out, a repository with no merge in progress) are enforced in Rust.
      moveBranch: (repo, branch, toCommit) =>
        call<void>("git_move_branch", { root: repo.root, branch, toCommit }),

      abortMerge: (repo) => call<void>("git_abort_merge", { root: repo.root }),

      progress: () => Stream.fromPubSub(events),
    } satisfies RemoteService;
  });

export const TauriRemoteLive = (
  options: TauriRemoteOptions,
): Layer.Layer<Remote, never, Credentials | Gitea> =>
  Layer.effect(
    Remote,
    Effect.gen(function* () {
      const credentials = yield* Credentials;
      const gitea = yield* Gitea;
      return yield* makeTauriRemote(options, credentials, gitea);
    }),
  );
