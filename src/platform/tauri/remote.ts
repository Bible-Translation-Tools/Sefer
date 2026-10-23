import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Effect, Layer, Option, PubSub, Stream } from "effect";

import type { Repo } from "#core/git/git";
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

const ORIGIN = "origin";

const PROGRESS_DEPTH = 64;

const PROGRESS_EVENT = "sefer://git-progress";

export interface TauriRemoteOptions {
  readonly endpoint: string | null;
}

interface WireProbe {
  readonly default_branch: string | null;
  readonly head: string | null;
  readonly empty: boolean;
}

interface WireProgress {
  readonly phase: string;
  readonly loaded: number;
  readonly total: number | null;
}

const fail = (reason: RemoteFailureReason, description: string): RemoteError =>
  new RemoteError({ reason, description });

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

const progressOf = (wire: WireProgress): Progress => ({
  phase: wire.phase,
  loaded: wire.loaded,
  ...(wire.total === null ? {} : { total: wire.total }),
});

const makeTauriRemote = (
  options: TauriRemoteOptions,
  credentials: CredentialsService,
  gitea: GiteaService,
): Effect.Effect<RemoteService> =>
  Effect.gen(function* () {
    const events = yield* PubSub.sliding<Progress>({ capacity: PROGRESS_DEPTH });
    yield* Effect.promise(() =>
      listen<WireProgress>(PROGRESS_EVENT, (event) => {
        Effect.runFork(PubSub.publish(events, progressOf(event.payload)));
      }),
    );

    const originUrl = (repo: Repo, name = ORIGIN): Effect.Effect<string, RemoteError> =>
      Effect.flatMap(call<string | null>("git_remote_url", { root: repo.root, name }), (url) =>
        url === null
          ? Effect.fail(fail("Unavailable", "this project has no remote attached yet"))
          : Effect.succeed(url),
      );

    const credentialFor = (
      url: string,
    ): Effect.Effect<Option.Option<{ readonly username: string; readonly token: string }>> =>
      Effect.map(
        credentials.get(hostOf(url)),
        Option.map((credential) => ({ username: credential.username, token: credential.token })),
      );

    const transfer = (
      command: string,
      repo: Repo,
      auth: "required" | "optional",
      name = ORIGIN,
    ): Effect.Effect<Progress, RemoteError> =>
      Effect.gen(function* () {
        const url = yield* originUrl(repo, name);
        const held = yield* credentialFor(url);
        if (auth === "required" && Option.isNone(held)) {
          return yield* Effect.fail(
            fail("Unauthorized", `no credential for ${hostOf(url)}; sign in first`),
          );
        }
        const credential = Option.getOrNull(held);
        const wire = yield* call<WireProgress>(command, {
          root: repo.root,
          remote: name,
          username: credential?.username ?? null,
          token: credential?.token ?? null,
        });
        const progress = progressOf(wire);
        yield* PubSub.publish(events, progress);
        return progress;
      });

    const attach = (repo: Repo, url: string): Effect.Effect<void, RemoteError> =>
      call<void>("git_ensure_remote", { root: repo.root, name: ORIGIN, url });

    return {
      clone: (url, into, cloning) =>
        Effect.gen(function* () {
          const credential = Option.getOrNull(yield* credentialFor(url));
          const wire = yield* call<WireProgress>("git_clone", {
            url,
            root: into,
            username: credential?.username ?? null,
            token: credential?.token ?? null,
            depth: (cloning?.history ?? "latest") === "latest" ? 1 : null,
          });
          const progress = progressOf(wire);
          yield* PubSub.publish(events, progress);
          return { repo: { root: into } satisfies Repo, progress };
        }),

      attach,
      attachAs: (repo, name, url) =>
        call<void>("git_ensure_remote", { root: repo.root, name, url }),
      urlOf: (repo, name) =>
        Effect.map(
          call<string | null>("git_remote_url", { root: repo.root, name }),
          Option.fromNullishOr,
        ),
      fetchRef: (repo, from, into, remote = ORIGIN) =>
        Effect.gen(function* () {
          const url = yield* originUrl(repo, remote);
          const credential = Option.getOrNull(yield* credentialFor(url));
          return yield* call<string>("git_fetch_ref", {
            root: repo.root,
            remote,
            from,
            into,
            username: credential?.username ?? null,
            token: credential?.token ?? null,
          });
        }),
      origin: (repo) =>
        Effect.map(
          call<string | null>("git_remote_url", { root: repo.root, name: ORIGIN }),
          Option.fromNullishOr,
        ),
      probe: (url) =>
        Effect.gen(function* () {
          const credential = Option.getOrNull(yield* credentialFor(url));
          const wire = yield* call<WireProbe>("git_probe", {
            url,
            username: credential?.username ?? null,
            token: credential?.token ?? null,
          });
          return {
            defaultBranch: Option.fromNullishOr(wire.default_branch),
            head: Option.fromNullishOr(wire.head),
            empty: wire.empty,
          } satisfies Probe;
        }),
      fetch: (repo) => transfer("git_fetch", repo, "optional"),
      backfills: true,
      deepen: (repo, more) =>
        Effect.gen(function* () {
          const url = yield* originUrl(repo);
          const credential = Option.getOrNull(yield* credentialFor(url));
          const progress = progressOf(
            yield* call<WireProgress>("git_deepen", {
              root: repo.root,
              remote: ORIGIN,
              more: more === "all" ? null : more,
              username: credential?.username ?? null,
              token: credential?.token ?? null,
            }),
          );
          yield* PubSub.publish(events, progress);
          return progress;
        }),
      fastForward: (repo, to) => call<void>("git_fast_forward", { root: repo.root, to }),
      push: (repo, to) => transfer("git_push", repo, "required", to ?? ORIGIN),
      publish: (repo, target) =>
        Effect.gen(function* () {
          const url = target.startsWith("http")
            ? target
            : yield* createOnGitea(
                gitea,
                options.endpoint,
                target,
                "this build has no WACS server: set one in Settings",
              );
          yield* attach(repo, url);
          yield* transfer("git_push", repo, "required");
        }),
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
