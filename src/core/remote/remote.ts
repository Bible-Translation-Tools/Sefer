import { Context, Data, Effect, Option, Stream } from "effect";

import type { Repo } from "../git/git";
import type { Verdict } from "../observability";

export interface Progress {
  readonly phase: string;
  readonly loaded: number;
  readonly total?: number | undefined;
  readonly unit?: "objects" | "bytes";
}

export type RemoteFailureReason = "Unavailable" | "Unauthorized" | "Network" | "Rejected";

export const remoteVerdict = (reason: RemoteFailureReason | undefined): Verdict => {
  if (reason === "Unavailable" || reason === "Network") return "unavailable";
  if (reason === "Unauthorized" || reason === "Rejected") return "refused";
  return "failed";
};

export class RemoteError extends Data.TaggedError("RemoteError")<{
  readonly reason: RemoteFailureReason;
  readonly description?: string | undefined;
}> {}

export interface Probe {
  readonly defaultBranch: Option.Option<string>;
  readonly head: Option.Option<string>;
  readonly empty: boolean;
}

export type CloneHistory = "latest" | "all";

export interface CloneOptions {
  readonly history?: CloneHistory;
}

export type Deepen = number | "all";

export interface RemoteService {
  readonly clone: (
    url: string,
    into: string,
    options?: CloneOptions,
  ) => Effect.Effect<{ readonly repo: Repo; readonly progress: Progress }, RemoteError>;
  readonly attach: (repo: Repo, url: string) => Effect.Effect<void, RemoteError>;
  readonly attachAs: (repo: Repo, name: string, url: string) => Effect.Effect<void, RemoteError>;
  readonly urlOf: (repo: Repo, name: string) => Effect.Effect<Option.Option<string>, RemoteError>;
  readonly fetchRef: (
    repo: Repo,
    from: string,
    into: string,
    remote?: string,
  ) => Effect.Effect<string, RemoteError>;
  readonly origin: (repo: Repo) => Effect.Effect<Option.Option<string>, RemoteError>;
  readonly probe: (url: string) => Effect.Effect<Probe, RemoteError>;
  readonly fetch: (repo: Repo) => Effect.Effect<Progress, RemoteError>;
  readonly deepen: (repo: Repo, more: Deepen) => Effect.Effect<Progress, RemoteError>;
  readonly backfills: boolean;
  readonly fastForward: (repo: Repo, to: string) => Effect.Effect<void, RemoteError>;
  readonly push: (repo: Repo, to?: string) => Effect.Effect<Progress, RemoteError>;
  readonly publish: (repo: Repo, target: string) => Effect.Effect<void, RemoteError>;
  readonly abortMerge: (repo: Repo) => Effect.Effect<void, RemoteError>;
  readonly progress: () => Stream.Stream<Progress>;
}

export class Remote extends Context.Service<Remote, RemoteService>()("Remote") {}
