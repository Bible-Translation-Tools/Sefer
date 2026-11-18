import { Effect, FileSystem, Layer, Option, PubSub, Stream } from "effect";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { nodeFsView, type IsomorphicFs } from "#core/fileSystem/nodeView";
import { joinPath } from "#core/fileSystem/path";
import { DEFAULT_BRANCH, REPLAYED_REF, type Repo } from "#core/git/git";
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

/**
 * The slowest upload a request is given time for before it counts as stalled
 * (16 KB/s): the server says nothing until a pushed pack is all in, so a body
 * gets its own allowance on top of `STALL_MS`.
 */
const UPLOAD_BYTES_PER_MS = 16;

const collect = async (body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    bytes += chunk.byteLength;
  }
  return { chunks, bytes };
};

/** Chunks already in hand, as the async body isomorphic-git's http clients take. */
async function* streamOf(chunks: readonly Uint8Array[]): AsyncIterableIterator<Uint8Array> {
  yield* chunks;
}

/** The chunks as one array. */
const joined = (chunks: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
};

/** One pkt-line: four hex digits of length (its own four included), then the line. */
const pktLine = (line: string): Uint8Array => {
  const bytes = new TextEncoder().encode(line);
  const out = new Uint8Array(bytes.length + 4);
  out.set(new TextEncoder().encode((bytes.length + 4).toString(16).padStart(4, "0")));
  out.set(bytes, 4);
  return out;
};

/** Whether a pack index (v2) lists `oid`: a binary search of its sorted names. */
const indexHolds = (idx: Uint8Array, oid: string): boolean => {
  if (idx.length < 8 + 1024 || idx[0] !== 0xff || idx[1] !== 0x74 || idx[2] !== 0x4f) return false;
  const view = new DataView(idx.buffer, idx.byteOffset, idx.byteLength);
  const count = view.getUint32(8 + 255 * 4);
  const names = 8 + 1024;
  if (idx.length < names + count * 20) return false;
  const hexAt = (i: number): string => {
    let hex = "";
    for (let b = 0; b < 20; b++) hex += idx[names + i * 20 + b].toString(16).padStart(2, "0");
    return hex;
  };
  let lo = 0;
  let hi = count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = hexAt(mid);
    if (at === oid) return true;
    if (at < oid) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const fail = (reason: RemoteFailureReason, description: string): RemoteError =>
  new RemoteError({ reason, description });

const classify = (error: unknown): RemoteError => {
  const message = messageOf(error);
  if (/permission denied|not allowed to push/iu.test(message)) return fail("Unauthorized", message);
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
        const restart = (wait = STALL_MS): void => {
          if (timer !== undefined) clearTimeout(timer);
          timer = setTimeout(
            () => controller.abort(new Error(`stalled: nothing for ${wait / 1000} s`)),
            wait,
          );
        };
        const sent = request.body === undefined ? undefined : await collect(request.body);
        restart(STALL_MS + Math.ceil((sent?.bytes ?? 0) / UPLOAD_BYTES_PER_MS));
        try {
          const response = await http.request({
            ...request,
            ...(sent === undefined ? {} : { body: streamOf(sent.chunks) }),
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

    /**
     * A first publish of a migrated project: an empty repository is sent the
     * migration's own pack (`REPLAYED_REF`) in one receive-pack request.
     * isomorphic-git's push would walk every object and repack them without
     * deltas — for a Bible's Writer history 28,408 commits went from a 31 MB
     * pack to an 823 MB upload built whole in memory. The push after this one
     * sends only what came since. Anything unexpected leaves it to that push.
     */
    const seedFromReplay = (repo: Repo): Effect.Effect<void, RemoteError> =>
      Effect.gen(function* () {
        const head = yield* Effect.orElseSucceed(
          attempt(() => git.resolveRef({ fs, dir: repo.root, ref: REPLAYED_REF })),
          () => undefined,
        );
        if (head === undefined) return;
        const packs = joinPath(repo.root, ".git/objects/pack");
        const names = yield* Effect.orElseSucceed(fileSystem.readDirectory(packs), () => []);
        let pack: Uint8Array | undefined;
        for (const name of names.filter((each) => each.endsWith(".idx"))) {
          const idx = yield* Effect.orElseSucceed(
            fileSystem.readFile(joinPath(packs, name)),
            () => new Uint8Array(),
          );
          if (!indexHolds(idx, head)) continue;
          pack = yield* Effect.orElseSucceed(
            fileSystem.readFile(joinPath(packs, name.replace(/\.idx$/u, ".pack"))),
            () => undefined,
          );
          break;
        }
        if (pack === undefined) return;
        const last = { current: { phase: "done", loaded: 0 } satisfies Progress };
        const wire = yield* wireFor(repo, last, "required");
        const url = yield* urlNamed(repo);
        const info = yield* attempt(() =>
          git.getRemoteInfo2({
            http: wire.http,
            url,
            headers: wire.headers,
            ...(wire.onAuth === undefined ? {} : { onAuth: wire.onAuth }),
            forPush: true,
            protocolVersion: 1,
          }),
        );
        if ((info.refs ?? []).some((entry) => entry.ref.startsWith("refs/heads/"))) return;
        const branch = yield* branchOf(repo);
        const credential = wire.onAuth?.();
        const update = `${"0".repeat(40)} ${head} refs/heads/${branch}\0report-status\n`;
        const total = pack.byteLength;
        PubSub.publishUnsafe(events, { phase: "Sending history", loaded: 0, total, unit: "bytes" });
        const response = yield* attempt(() =>
          transported.request({
            url: `${url.replace(/\/+$/u, "")}/git-receive-pack`,
            method: "POST",
            headers: {
              ...wire.headers,
              "Content-Type": "application/x-git-receive-pack-request",
              Accept: "application/x-git-receive-pack-result",
              ...(credential === undefined
                ? {}
                : {
                    Authorization: `Basic ${btoa(`${credential.username}:${credential.password}`)}`,
                  }),
            },
            body: streamOf([pktLine(update), new TextEncoder().encode("0000"), pack]),
          }),
        );
        const reply = new TextDecoder().decode(
          joined((yield* attempt(() => collect(response.body ?? []))).chunks),
        );
        if (
          response.statusCode !== 200 ||
          !reply.includes("unpack ok") ||
          !reply.includes(`ok refs/heads/${branch}`)
        )
          return yield* Effect.fail(
            fail(
              response.statusCode === 401 || response.statusCode === 403
                ? "Unauthorized"
                : "Rejected",
              `the history was not taken (${response.statusCode}): ${reply.replace(/[^\x20-\x7e]+/gu, " ").trim()}`,
            ),
          );
        PubSub.publishUnsafe(events, {
          phase: "Sending history",
          loaded: total,
          total,
          unit: "bytes",
        });
        yield* Effect.ignore(
          attempt(() => git.deleteRef({ fs, dir: repo.root, ref: REPLAYED_REF })),
        );
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
          yield* seedFromReplay(repo);
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
