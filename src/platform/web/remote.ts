/**
 * The Web answer to the `Remote` port: isomorphic-git's browser HTTP client
 * over the same OPFS bytes `WebGitLive` commits.
 *
 * Three things make the Web path different from desktop's, and all three are
 * visible in this file:
 *
 * 1. A browser cannot speak git smart-HTTP to an arbitrary origin — the
 *    server would have to send CORS headers, and Gitea does not. So every
 *    request goes through the TRANSPORT (`src/core/remote/transport.ts`): the
 *    proxy that fronts the URL's host (`wacs-isomorphic-git-proxy`), which
 *    answers on Gitea's own paths. The rewrite happens inside the HTTP client,
 *    at request time and nowhere else, so `.git/config` names the CONTENT
 *    HOST — the same URL a desktop clone stores — and a project moves between
 *    the two hosts unchanged. isomorphic-git's `corsProxy` is not used: its
 *    URL shape (`/{host}/{owner}/{repo}.git/…`) is not the proxy's.
 * 2. Credentials come from the host `Credentials` service, keyed by the
 *    remote's origin — the content host, the same key Gitea files a sign-in
 *    under. Tokens never reach a project file, and `onAuth` is the only place
 *    isomorphic-git is told one.
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

import { nodeFsView, type IsomorphicFs } from "#core/fileSystem/nodeView";
import type { Repo } from "#core/git/git";
import { Credentials, type CredentialsService } from "#core/host/credentials";
import { Gitea, type GiteaService } from "#core/remote/gitea";
import { createOnGitea, hostOf } from "#core/remote/onGitea";
import {
  Remote,
  RemoteError,
  type Progress,
  type RemoteFailureReason,
  type RemoteService,
} from "#core/remote/remote";
import { identityOf, through, type Transport } from "#core/remote/transport";

// isomorphic-git reads a global `Buffer` that no bundler supplies to a browser
// build. `./git` installs one at module load for exactly that reason; importing
// it for the side effect shares that one install rather than assigning a second.
import "./git";

export interface WebRemoteOptions {
  /**
   * The content host a publish-by-name creates its repository on. `null` is
   * a build with no cloud at all, and the landing screens say so rather than
   * offering a button that cannot work.
   */
  readonly contentHost: string | null;
  /** How this browser reaches each content host. */
  readonly transport: Transport;
  /** What the proxy expects in `X-Requested-With`. */
  readonly appId: string;
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
  readonly headers: Record<string, string> | undefined;
  /**
   * Absent when nobody is signed in. isomorphic-git asks only after a 401, so
   * a public clone never reaches for this — which is exactly what makes an
   * anonymous fetch work rather than fail with a credential error.
   */
  readonly onAuth: (() => { readonly username: string; readonly password: string }) | undefined;
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

    // isomorphic-git's client, with every request sent through the transport.
    // The one place a proxy URL exists; everything outside sees content hosts.
    const transported: typeof http = {
      request: (request) =>
        http.request({ ...request, url: through(options.transport, request.url) }),
    };

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

    /**
     * Records where this project's bytes come from: the CONTENT HOST's URL,
     * never a proxy's. A URL pasted from a proxy is mapped back to the host it
     * fronts, so whatever a caller hands in, `.git/config` names the server.
     */
    const attach = (repo: Repo, requested: string): Effect.Effect<void, RemoteError> =>
      Effect.gen(function* () {
        const url = identityOf(options.transport, requested);
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
      auth: "required" | "optional",
    ): Effect.Effect<Wire, RemoteError> =>
      Effect.gen(function* () {
        // No endpoint check here, and that is deliberate: a transfer goes to
        // the URL the PROJECT was attached to, which `attach` has already put
        // on this build's endpoint. What the endpoint gates is starting
        // something new — cloning, publishing — and those check it themselves.
        const url = yield* originUrl(repo);
        return yield* wireAt(url, repo.root, last, auth);
      });

    /** `wireFor` for a URL rather than a project: what a clone starts from. */
    const wireAt = (
      url: string,
      dir: string,
      last: { current: Progress },
      auth: "required" | "optional",
    ): Effect.Effect<Wire, RemoteError> =>
      Effect.gen(function* () {
        const held = yield* credentials.get(hostOf(url));
        // Push is the only transfer nobody can do anonymously. Refusing it
        // here rather than letting the server answer 401 is what turns "sign
        // in first" into advice instead of a status code; fetch and pull run
        // without a credential, because WACS content is public and cloning a
        // translation is how somebody gets started.
        if (auth === "required" && Option.isNone(held)) {
          return yield* Effect.fail(
            fail("Unauthorized", `no credential for ${hostOf(url)}; sign in first`),
          );
        }
        const credential = Option.getOrNull(held);
        return {
          fs,
          http: transported,
          dir,
          remote: ORIGIN,
          // The proxy gates on this; a host reached directly ignores it.
          headers: { "X-Requested-With": options.appId },
          onAuth:
            credential === null
              ? undefined
              : () => ({ username: credential.username, password: credential.token }),
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
      auth: "required" | "optional",
      call: (wire: Wire, branch: string) => Promise<unknown>,
    ): Effect.Effect<Progress, RemoteError> =>
      Effect.gen(function* () {
        const last = { current: { phase: "done", loaded: 0 } satisfies Progress };
        const wire = yield* wireFor(repo, last, auth);
        const branch = yield* branchOf(repo);
        yield* attempt(() => call(wire, branch));
        return last.current;
      });

    return {
      // isomorphic-git's own clone, not init-then-pull: it reads the server's
      // HEAD symref and checks that branch out, and it writes `origin` itself.
      // The URL is mapped to its content host first, exactly as `attach`
      // does, so what lands in `.git/config` is the same either way.
      clone: (requested, into) =>
        Effect.gen(function* () {
          const url = identityOf(options.transport, requested);
          const last = { current: { phase: "done", loaded: 0 } satisfies Progress };
          const wire = yield* wireAt(url, into, last, "optional");
          yield* attempt(() => git.clone({ ...wire, url, singleBranch: true }));
          return { repo: { root: into } satisfies Repo, progress: last.current };
        }),

      attach,

      // The read half of `attach`. `None` is "nothing attached", which is the
      // ordinary state of a project that has never been published.
      origin: (repo) =>
        Effect.map(
          attempt(() => git.listRemotes({ fs, dir: repo.root })),
          (remotes) => Option.fromNullishOr(remotes.find((entry) => entry.remote === ORIGIN)?.url),
        ),

      // A bare fetch: it updates the remote-tracking refs and touches no file
      // in the work tree, which is what makes it the safe thing to offer
      // someone who wants to know whether anything arrived.
      fetch: (repo) =>
        transfer(repo, "optional", (wire, branch) =>
          git.fetch({ ...wire, ref: branch, remoteRef: branch, singleBranch: true, prune: true }),
        ),

      // `pull` may write files and may need to make a merge commit, so it
      // carries an author. Fast-forward is not forced: a genuine divergence
      // must surface as `Rejected` rather than being silently resolved.
      pull: (repo) =>
        transfer(repo, "optional", (wire, branch) =>
          git.pull({ ...wire, ref: branch, singleBranch: true, author: MERGE_AUTHOR }),
        ),

      // A browser push over smart-HTTP normally takes one 401 on
      // `info/refs?service=git-receive-pack` before isomorphic-git calls
      // `onAuth` and retries; that first refusal is expected and never reaches
      // `classify` unless the retry fails too.
      push: (repo) =>
        transfer(repo, "required", (wire, branch) =>
          git.push({ ...wire, ref: branch, remoteRef: branch }),
        ),

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
          const url = target.startsWith("http")
            ? target
            : yield* createOnGitea(
                gitea,
                options.contentHost,
                target,
                "this build has no WACS server: set one in Settings",
              );
          yield* attach(repo, url);
          yield* transfer(repo, "required", (wire, branch) =>
            git.push({ ...wire, ref: branch, remoteRef: branch }),
          );
        }),

      /**
       * Combine's branch move: `writeRef` then a forced `checkout`, which is
       * exactly what v1 did. Refused unless `branch` is the checked-out one,
       * so the two hosts refuse the same thing — git2 checks it in Rust.
       */
      moveBranch: (repo, branch, toCommit) =>
        Effect.gen(function* () {
          const head = yield* branchOf(repo);
          if (head !== branch) {
            return yield* Effect.fail(
              fail(
                "Rejected",
                `HEAD is on ${head}, not ${branch}; cannot move a branch that is not checked out`,
              ),
            );
          }
          yield* attempt(() =>
            git.writeRef({
              fs,
              dir: repo.root,
              ref: `refs/heads/${branch}`,
              value: toCommit,
              force: true,
            }),
          );
          // Forced, because the point is to make the work tree BE the base the
          // replay sits on. The caller has already committed what it replays.
          yield* attempt(() => git.checkout({ fs, dir: repo.root, ref: branch, force: true }));
        }),

      // isomorphic-git throws when there is no `MERGE_HEAD`, which is the
      // refusal the port promises: a reset with nothing in progress would be
      // a silent discard rather than an undo.
      abortMerge: (repo) => Effect.asVoid(attempt(() => git.abortMerge({ fs, dir: repo.root }))),

      progress: () => Stream.fromPubSub(events),
    } satisfies RemoteService;
  });

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
