/**
 * The Web answer to the `Remote` port: isomorphic-git's browser HTTP client
 * over the same OPFS bytes `WebGitLive` commits.
 *
 * Three things make the Web path different from desktop's, and all three are
 * visible in this file:
 *
 * 1. A browser cannot speak git smart-HTTP to an arbitrary origin — the
 *    server would have to send CORS headers, and Gitea does not. So every
 *    transfer goes through a proxy, whose URL is `VITE_SEFER_GIT_CORS_PROXY_URL`
 *    (Will runs `wacs-isomorphic-git-proxy`). With no proxy configured there is
 *    no honest transfer, so every transfer refuses `Unavailable` and names the
 *    variable rather than failing later with a CORS error nobody can act on.
 * 2. Credentials come from the host `Credentials` service, keyed by the
 *    remote's ORIGIN. Tokens never reach a project file, and `onAuth` is the
 *    only place isomorphic-git is told one.
 * 3. `progress()` is a real stream because a browser transfer over a proxy is
 *    the slowest thing Sefer does. Every transfer publishes isomorphic-git's
 *    phase counters into one sliding PubSub, so the panel showing them cannot
 *    hold a transfer back and a slow reader loses old events rather than
 *    memory.
 *
 * `publish` is where this file meets `Gitea`: publishing by name creates the
 * repository if it is not there, then attaches and pushes. Publishing to a URL
 * assumes it exists and just attaches and pushes.
 */
import { Effect, FileSystem, Layer, Option, PubSub, Stream } from "effect";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { nodeFsView, type IsomorphicFs } from "../../core/fileSystem/nodeView";
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
// isomorphic-git reads a global `Buffer` that no bundler supplies to a browser
// build. `./git` installs one at module load for exactly that reason; importing
// it for the side effect shares that one install rather than assigning a second.
import "./git";

export interface WebRemoteOptions {
  /** `VITE_SEFER_GIT_CORS_PROXY_URL`; `null` disables every transfer. */
  readonly corsProxyUrl: string | null;
  /** `VITE_SEFER_GIT_PROXY_X_REQUESTED_WITH`; `null` sends no header. */
  readonly requestedWith: string | null;
  /** `VITE_SEFER_GITEA_WEB_HOST`; `null` disables publishing by name. */
  readonly giteaHost: string | null;
}

/** The remote Sefer attaches and transfers; one per project, always. */
const ORIGIN = "origin";

/** The default branch `WebGitLive.init` creates, and the one we transfer. */
const DEFAULT_BRANCH = "main";

/**
 * Who a merge commit is by when a pull has to make one. The same identity
 * `git.commit` uses in `src/app/commands.ts`; a merge is Sefer's bookkeeping,
 * not something the translator authored.
 */
const MERGE_AUTHOR = { name: "Sefer", email: "sefer@localhost" };

/** How many progress events a slow reader may fall behind before losing some. */
const PROGRESS_DEPTH = 64;

/** isomorphic-git's own progress callback shape. */
interface GitProgress {
  readonly phase: string;
  readonly loaded: number;
  readonly total?: number | undefined;
}

/**
 * Everything every transfer call passes to isomorphic-git, assembled once per
 * transfer. Named as a type so `transfer` can hand it to a caller that adds
 * only the refs it needs.
 */
interface Wire {
  readonly fs: IsomorphicFs;
  readonly http: typeof http;
  readonly dir: string;
  readonly remote: string;
  readonly corsProxy: string;
  readonly headers: Record<string, string> | undefined;
  readonly onAuth: () => { readonly username: string; readonly password: string };
  readonly onProgress: (event: GitProgress) => void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const fail = (reason: RemoteFailureReason, description: string): RemoteError =>
  new RemoteError({ reason, description });

/**
 * isomorphic-git reports transport failures as messages, not as codes, so this
 * is a translation of its (and the browser's) wording into the port's four
 * reasons. Order matters: a push rejection often also mentions a status code,
 * and "the far side refused" is the more useful of the two answers.
 *
 * The regexes are v1's, kept deliberately: they were tuned against a real WACS
 * instance behind a real proxy, and narrowing them is how a genuine
 * non-fast-forward starts being reported as an auth failure.
 */
const classify = (error: unknown): RemoteError => {
  const message = messageOf(error);
  if (
    /non-fast-forward|fetch first|failed to push some refs|push rejected|PushRejectedError/iu.test(
      message,
    )
  ) {
    return fail("Rejected", message);
  }
  if (/401|403|authentication|authorization|access denied|forbidden/iu.test(message)) {
    return fail("Unauthorized", message);
  }
  if (/network|offline|enotfound|econn|cors|failed to fetch/iu.test(message)) {
    return fail("Network", message);
  }
  // An unrecognised throw is still a refusal of the request, never a success.
  return fail("Rejected", message);
};

/** Every call into isomorphic-git funnels through here, so no throw escapes. */
const attempt = <A>(call: () => Promise<A>): Effect.Effect<A, RemoteError> =>
  Effect.tryPromise({ try: call, catch: classify });

/**
 * The origin of a remote URL — the `Credentials` key.
 *
 * A token belongs to a Gitea instance, not to one repository, so two projects
 * on the same instance share a credential. A URL that will not parse is its own
 * key: wrong, but no worse than refusing to look, and `Credentials.get`
 * answering `None` is already the "no credential" path.
 */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

const makeWebRemote = (
  options: WebRemoteOptions,
  fileSystem: FileSystem.FileSystem,
  credentials: CredentialsService,
  gitea: GiteaService,
): Effect.Effect<RemoteService> =>
  Effect.gen(function* () {
    const fs = nodeFsView(fileSystem, Effect.runPromise);
    // Sliding, not unbounded: progress is a live readout. If nothing is
    // watching, the events are worthless, and they must never be able to make
    // a transfer wait or a long fetch grow the heap.
    const events = yield* PubSub.sliding<Progress>({ capacity: PROGRESS_DEPTH });

    const originUrl = (repo: Repo): Effect.Effect<string, RemoteError> =>
      Effect.gen(function* () {
        const remotes = yield* attempt(() => git.listRemotes({ fs, dir: repo.root }));
        const found = remotes.find((entry) => entry.remote === ORIGIN);
        if (found === undefined) {
          return yield* Effect.fail(fail("Unavailable", "this project has no remote attached yet"));
        }
        return found.url;
      });

    /** The branch to transfer: whatever HEAD is on, else the default. */
    const branchOf = (repo: Repo): Effect.Effect<string, RemoteError> =>
      Effect.map(
        attempt(() => git.currentBranch({ fs, dir: repo.root, fullname: false })),
        (branch) => branch ?? DEFAULT_BRANCH,
      );

    const attach = (repo: Repo, url: string): Effect.Effect<void, RemoteError> =>
      Effect.gen(function* () {
        const remotes = yield* attempt(() => git.listRemotes({ fs, dir: repo.root }));
        const existing = remotes.find((entry) => entry.remote === ORIGIN);
        if (existing?.url === url) return;
        // `force` alone is not enough on every isomorphic-git version, and a
        // stale origin URL is the one thing that would push a translator's work
        // to the wrong repository. Delete, then add.
        if (existing !== undefined) {
          yield* attempt(() => git.deleteRemote({ fs, dir: repo.root, remote: ORIGIN }));
        }
        yield* attempt(() =>
          git.addRemote({ fs, dir: repo.root, remote: ORIGIN, url, force: true }),
        );
      });

    /**
     * Everything an isomorphic-git transfer call needs, assembled once.
     *
     * `last` is a mutable box because isomorphic-git hands progress to a
     * callback while the port promises the caller one final `Progress`: the
     * last event seen is that answer.
     */
    const wireFor = (
      repo: Repo,
      last: { current: Progress },
    ): Effect.Effect<Wire, RemoteError> =>
      Effect.gen(function* () {
        if (options.corsProxyUrl === null) {
          return yield* Effect.fail(
            fail(
              "Unavailable",
              "this build has no git CORS proxy: set VITE_SEFER_GIT_CORS_PROXY_URL",
            ),
          );
        }
        const url = yield* originUrl(repo);
        const held = yield* credentials.get(hostOf(url));
        if (Option.isNone(held)) {
          return yield* Effect.fail(
            fail("Unauthorized", `no credential for ${hostOf(url)}; sign in first`),
          );
        }
        const credential = held.value;
        return {
          fs,
          http,
          dir: repo.root,
          remote: ORIGIN,
          corsProxy: options.corsProxyUrl,
          headers:
            options.requestedWith === null
              ? undefined
              : { "X-Requested-With": options.requestedWith },
          onAuth: () => ({ username: credential.username, password: credential.token }),
          onProgress: (event: GitProgress) => {
            const progress: Progress = {
              phase: event.phase,
              loaded: event.loaded,
              total: event.total,
            };
            last.current = progress;
            // Unsafe = non-blocking. A full sliding PubSub drops its oldest
            // event, which is the right trade for a progress readout.
            PubSub.publishUnsafe(events, progress);
          },
        };
      });

    /**
     * One transfer, answered with the last progress event it reported. A
     * transfer that reported nothing still answers, with `phase: "done"` and
     * no bytes — an already-up-to-date fetch legitimately moves nothing.
     */
    const transfer = (
      repo: Repo,
      call: (wire: Wire, branch: string) => Promise<unknown>,
    ): Effect.Effect<Progress, RemoteError> =>
      Effect.gen(function* () {
        const last = { current: { phase: "done", loaded: 0 } satisfies Progress };
        const wire = yield* wireFor(repo, last);
        const branch = yield* branchOf(repo);
        yield* attempt(() => call(wire, branch));
        return last.current;
      });

    return {
      attach,

      // A bare fetch: it updates the remote-tracking refs and touches no file
      // in the work tree, which is what makes it the safe thing to offer
      // someone who wants to know whether anything arrived.
      fetch: (repo) =>
        transfer(repo, (wire, branch) =>
          git.fetch({ ...wire, ref: branch, remoteRef: branch, singleBranch: true, prune: true }),
        ),

      // `pull` may write files and may need to make a merge commit, so it
      // carries an author. Fast-forward is not forced: a genuine divergence
      // must surface as `Rejected` rather than being silently resolved.
      pull: (repo) =>
        transfer(repo, (wire, branch) =>
          git.pull({ ...wire, ref: branch, singleBranch: true, author: MERGE_AUTHOR }),
        ),

      // A browser push over smart-HTTP normally takes one 401 on
      // `info/refs?service=git-receive-pack` before isomorphic-git calls
      // `onAuth` and retries; that first refusal is expected and never reaches
      // `classify` unless the retry fails too.
      push: (repo) =>
        transfer(repo, (wire, branch) => git.push({ ...wire, ref: branch, remoteRef: branch })),

      /**
       * First publish. `target` is either a full URL — attach it and push — or
       * a repository name (`name`, or `owner/name`) on the configured Gitea
       * host, in which case it is created if it is not already there.
       *
       * Resolving the URL BEFORE attaching is deliberate: if creation fails,
       * the project is left with no origin at all rather than one pointing at
       * something that does not exist.
       */
      publish: (repo, target) =>
        Effect.gen(function* () {
          const url = target.startsWith("http") ? target : yield* createOnGitea(target);
          yield* attach(repo, url);
          yield* transfer(repo, (wire, branch) =>
            git.push({ ...wire, ref: branch, remoteRef: branch }),
          );
        }),

      progress: () => Stream.fromPubSub(events),
    } satisfies RemoteService;

    /** `owner/name` or `name` on the configured host → the URL to attach. */
    function createOnGitea(target: string): Effect.Effect<string, RemoteError> {
      return Effect.gen(function* () {
        const host = options.giteaHost;
        if (host === null) {
          return yield* Effect.fail(
            fail("Unavailable", "this build has no Gitea host: set VITE_SEFER_GITEA_WEB_HOST"),
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
    }
  });

/** A `Gitea` call seen as a `Remote` one, so `publish` has one error type. */
const fromGitea = <A>(effect: Effect.Effect<A, GiteaError>): Effect.Effect<A, RemoteError> =>
  Effect.mapError(effect, (error) =>
    fail(reasonOf(error.reason), error.description ?? error.reason),
  );

/**
 * A `GiteaError` reason as a `RemoteError` reason. `OtpRequired` collapses into
 * `Unauthorized` here because a transfer has no OTP field to offer — the sign-in
 * surface is where that distinction is actionable.
 */
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

export const WebRemoteLive = (
  options: WebRemoteOptions,
): Layer.Layer<Remote, never, FileSystem.FileSystem | Credentials | Gitea> =>
  Layer.effect(
    Remote,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const credentials = yield* Credentials;
      const gitea = yield* Gitea;
      return yield* makeWebRemote(options, fileSystem, credentials, gitea);
    }),
  );
