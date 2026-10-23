import { Effect, FileSystem, Layer, Option, PubSub, Stream } from "effect";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { nodeFsView, type IsomorphicFs } from "#core/fileSystem/nodeView";
import { DEFAULT_BRANCH, type Repo } from "#core/git/git";
import { Credentials, type CredentialsService } from "#core/host/credentials";
import { Gitea, type GiteaService } from "#core/remote/gitea";
import { createOnGitea, hostOf } from "#core/remote/onGitea";
import {
  Remote,
  RemoteError,
  type Probe,
  type Progress,
  type RemoteFailureReason,
  type RemoteService,
} from "#core/remote/remote";
import { identityOf, through, type Transport } from "#core/remote/transport";

import "./git";

export interface WebRemoteOptions {
  readonly contentHost: string | null;
  readonly transport: Transport;
  readonly appId: string;
}

const ORIGIN = "origin";

const PROGRESS_DEPTH = 64;

interface GitProgress {
  readonly phase: string;
  readonly loaded: number;
  readonly total?: number | undefined;
}

interface Wire {
  readonly fs: IsomorphicFs;
  readonly http: typeof http;
  readonly dir: string;
  readonly remote: string;
  readonly headers: Record<string, string> | undefined;
  readonly onAuth: (() => { readonly username: string; readonly password: string }) | undefined;
  readonly onProgress: (event: GitProgress) => void;
}

const UNSHALLOW = 2_147_483_647;

const STALL_MS = 60_000;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const fail = (reason: RemoteFailureReason, description: string): RemoteError =>
  new RemoteError({ reason, description });

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
  if (/network|offline|enotfound|econn|cors|failed to fetch|stalled|aborted/iu.test(message)) {
    return fail("Network", message);
  }
  return fail("Rejected", message);
};

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
    const events = yield* PubSub.sliding<Progress>({ capacity: PROGRESS_DEPTH });

    const transported: typeof http = {
      request: async (request) => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const restart = (): void => {
          if (timer !== undefined) clearTimeout(timer);
          timer = setTimeout(
            () => controller.abort(new Error(`stalled: nothing for ${STALL_MS / 1000} s`)),
            STALL_MS,
          );
        };
        restart();
        try {
          const response = await http.request({
            ...request,
            url: through(options.transport, request.url),
            signal: controller.signal,
          });
          const chunks = response.body;
          const counting = request.url.endsWith("/git-upload-pack");
          let received = 0;
          let said = 0;
          const body = async function* (): AsyncGenerator<Uint8Array> {
            try {
              for await (const chunk of chunks ?? []) {
                restart();
                if (counting) {
                  received += chunk.byteLength;
                  if (received - said >= 65_536) {
                    said = received;
                    PubSub.publishUnsafe(events, {
                      phase: "Receiving data",
                      loaded: received,
                      unit: "bytes",
                    });
                  }
                }
                yield chunk;
              }
            } finally {
              if (timer !== undefined) clearTimeout(timer);
            }
          };
          return { ...response, body: body() };
        } catch (error) {
          if (timer !== undefined) clearTimeout(timer);
          throw error;
        }
      },
    };

    const urlNamed = (repo: Repo, name = ORIGIN): Effect.Effect<string, RemoteError> =>
      Effect.gen(function* () {
        const remotes = yield* attempt(() => git.listRemotes({ fs, dir: repo.root }));
        const found = remotes.find((entry) => entry.remote === name);
        if (found === undefined) {
          return yield* Effect.fail(fail("Unavailable", "this project has no remote attached yet"));
        }
        return found.url;
      });

    const branchOf = (repo: Repo): Effect.Effect<string, RemoteError> =>
      Effect.map(
        attempt(() => git.currentBranch({ fs, dir: repo.root, fullname: false })),
        (branch) => branch ?? DEFAULT_BRANCH,
      );

    const attachAs = (
      repo: Repo,
      name: string,
      requested: string,
    ): Effect.Effect<void, RemoteError> =>
      Effect.gen(function* () {
        const url = identityOf(options.transport, requested);
        const remotes = yield* attempt(() => git.listRemotes({ fs, dir: repo.root }));
        const existing = remotes.find((entry) => entry.remote === name);
        if (existing?.url === url) return;
        if (existing !== undefined) {
          yield* attempt(() => git.deleteRemote({ fs, dir: repo.root, remote: name }));
        }
        yield* attempt(() => git.addRemote({ fs, dir: repo.root, remote: name, url, force: true }));
      });

    const attach = (repo: Repo, requested: string): Effect.Effect<void, RemoteError> =>
      attachAs(repo, ORIGIN, requested);

    const wireFor = (
      repo: Repo,
      last: { current: Progress },
      auth: "required" | "optional",
      name = ORIGIN,
    ): Effect.Effect<Wire, RemoteError> =>
      Effect.gen(function* () {
        const url = yield* urlNamed(repo, name);
        return { ...(yield* wireAt(url, repo.root, last, auth)), remote: name };
      });

    const wireAt = (
      url: string,
      dir: string,
      last: { current: Progress },
      auth: "required" | "optional",
    ): Effect.Effect<Wire, RemoteError> =>
      Effect.gen(function* () {
        const held = yield* credentials.get(hostOf(url));
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
            PubSub.publishUnsafe(events, progress);
          },
        };
      });

    const transfer = (
      repo: Repo,
      auth: "required" | "optional",
      call: (wire: Wire, branch: string) => Promise<unknown>,
      name = ORIGIN,
    ): Effect.Effect<Progress, RemoteError> =>
      Effect.gen(function* () {
        const last = { current: { phase: "done", loaded: 0 } satisfies Progress };
        const wire = yield* wireFor(repo, last, auth, name);
        const branch = yield* branchOf(repo);
        yield* attempt(() => call(wire, branch));
        return last.current;
      });

    return {
      clone: (requested, into, cloning) =>
        Effect.gen(function* () {
          const url = identityOf(options.transport, requested);
          const last = { current: { phase: "done", loaded: 0 } satisfies Progress };
          const wire = yield* wireAt(url, into, last, "optional");
          const latest = (cloning?.history ?? "latest") === "latest";
          yield* attempt(() =>
            git.clone({ ...wire, url, singleBranch: true, ...(latest ? { depth: 1 } : {}) }),
          );
          return { repo: { root: into } satisfies Repo, progress: last.current };
        }),

      attach,
      attachAs,

      urlOf: (repo, name) =>
        Effect.map(
          attempt(() => git.listRemotes({ fs, dir: repo.root })),
          (remotes) => Option.fromNullishOr(remotes.find((entry) => entry.remote === name)?.url),
        ),

      fetchRef: (repo, from, into, remote = ORIGIN) =>
        Effect.gen(function* () {
          const last = { current: { phase: "done", loaded: 0 } satisfies Progress };
          const wire = yield* wireFor(repo, last, "optional", remote);
          const fetched = yield* attempt(() =>
            git.fetch({ ...wire, ref: from, remoteRef: from, singleBranch: true, tags: false }),
          );
          const head = fetched.fetchHead;
          if (head === null || head === undefined)
            return yield* Effect.fail(
              fail(
                "Rejected",
                `${from} is not on ${remote === ORIGIN ? "the shared project" : "your copy"}`,
              ),
            );
          yield* attempt(() =>
            git.writeRef({ fs, dir: repo.root, ref: into, value: head, force: true }),
          );
          return head;
        }),

      origin: (repo) =>
        Effect.map(
          attempt(() => git.listRemotes({ fs, dir: repo.root })),
          (remotes) => Option.fromNullishOr(remotes.find((entry) => entry.remote === ORIGIN)?.url),
        ),

      probe: (requested) =>
        Effect.gen(function* () {
          const url = identityOf(options.transport, requested);
          const last = { current: { phase: "done", loaded: 0 } satisfies Progress };
          const wire = yield* wireAt(url, "", last, "optional");
          const info = yield* attempt(() =>
            git.getRemoteInfo2({
              http: wire.http,
              url,
              headers: wire.headers,
              ...(wire.onAuth === undefined ? {} : { onAuth: wire.onAuth }),
              protocolVersion: 1,
            }),
          );
          const refs = info.refs ?? [];
          const head = refs.find((entry) => entry.ref === "HEAD");
          const heads = refs.filter((entry) => entry.ref.startsWith("refs/heads/"));
          return {
            defaultBranch: Option.fromNullishOr(head?.target?.replace(/^refs\/heads\//u, "")),
            head: Option.fromNullishOr(head?.oid),
            empty: heads.length === 0,
          } satisfies Probe;
        }),

      fetch: (repo) =>
        transfer(repo, "optional", (wire, branch) =>
          git.fetch({ ...wire, ref: branch, remoteRef: branch, singleBranch: true, prune: true }),
        ),

      backfills: false,

      deepen: (repo, more) =>
        transfer(repo, "optional", (wire, branch) =>
          git.fetch({
            ...wire,
            ref: branch,
            remoteRef: branch,
            singleBranch: true,
            tags: false,
            ...(more === "all" ? { depth: UNSHALLOW } : { depth: more, relative: true }),
          }),
        ),

      fastForward: (repo, to) =>
        Effect.gen(function* () {
          const branch = yield* attempt(() =>
            git.currentBranch({ fs, dir: repo.root, fullname: false }),
          );
          if (typeof branch !== "string")
            return yield* Effect.fail(fail("Rejected", "HEAD is not on a branch"));
          const head = yield* Effect.orElseSucceed(
            attempt(() => git.resolveRef({ fs, dir: repo.root, ref: "HEAD" })),
            () => undefined,
          );
          if (head === to) return;
          if (head !== undefined) {
            const forward = yield* attempt(() =>
              git.isDescendent({ fs, dir: repo.root, oid: to, ancestor: head, depth: -1 }),
            );
            if (!forward)
              return yield* Effect.fail(
                fail("Rejected", `${to} does not descend from ${branch}; not a fast-forward`),
              );
          }
          yield* attempt(() => git.checkout({ fs, dir: repo.root, ref: to, noUpdateHead: true }));
          yield* attempt(() =>
            git.writeRef({
              fs,
              dir: repo.root,
              ref: `refs/heads/${branch}`,
              value: to,
              force: true,
            }),
          );
        }),

      push: (repo, to) =>
        transfer(
          repo,
          "required",
          (wire, branch) => git.push({ ...wire, ref: branch, remoteRef: branch }),
          to ?? ORIGIN,
        ),

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
