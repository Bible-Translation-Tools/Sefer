import type { Commit, CommitId } from "../git/git";
import type { RemoteFailureReason } from "../remote/remote";

export type SyncState =
  | "detached"
  | "unpublished"
  | "attached-clean"
  | "ahead"
  | "behind"
  | "diverged"
  | "conflicted"
  | "checking"
  | "offline"
  | "unauthorized";

export interface Clock {
  readonly at: number | undefined;
  readonly unshared: number;
  readonly by: string | undefined;
}

export interface Clocks {
  readonly local: Clock;
  readonly shared: Clock;
}

export interface SyncReading {
  readonly origin: string | undefined;
  readonly branch: string | undefined;
  readonly signedIn: boolean;
  readonly online: boolean;
  readonly fetchedAt: number | undefined;
  readonly remoteKnown: boolean;
  readonly localHead: Commit | undefined;
  readonly remoteHead: Commit | undefined;
  readonly ahead: readonly Commit[];
  readonly behind: readonly Commit[];
  readonly uncommitted: number;
  readonly mergeInProgress: boolean;
  readonly lastFailure: RemoteFailureReason | undefined;
  readonly checking: boolean;
  readonly sendRefused: boolean;
}

export const emptyReading: SyncReading = {
  origin: undefined,
  branch: undefined,
  signedIn: false,
  online: true,
  fetchedAt: undefined,
  remoteKnown: false,
  localHead: undefined,
  remoteHead: undefined,
  ahead: [],
  behind: [],
  uncommitted: 0,
  mergeInProgress: false,
  lastFailure: undefined,
  checking: false,
  sendRefused: false,
};

const syncStateOf = (reading: SyncReading): SyncState => {
  if (reading.mergeInProgress) return "conflicted";
  if (reading.checking) return "checking";
  if (!reading.online || reading.lastFailure === "Network") return "offline";
  if (!reading.signedIn || reading.lastFailure === "Unauthorized") return "unauthorized";
  if (reading.origin === undefined) return "detached";
  if (!reading.remoteKnown) return "unpublished";
  const ahead = reading.ahead.length > 0;
  const behind = reading.behind.length > 0;
  if (ahead && behind) return "diverged";
  if (ahead) return "ahead";
  if (behind) return "behind";
  return "attached-clean";
};

const clocksOf = (reading: SyncReading): Clocks => ({
  local: { at: reading.localHead?.at, unshared: reading.ahead.length, by: undefined },
  shared: {
    at: reading.remoteHead?.at,
    unshared: reading.behind.length,
    by: reading.behind.length > 0 ? reading.remoteHead?.author.name : undefined,
  },
});

export type SyncActionId =
  | "sign-in"
  | "attach"
  | "publish"
  | "pull"
  | "push"
  | "combine"
  | "compare"
  | "resolve"
  | "retry";

const primaryActionOf = (state: SyncState, contested = false): SyncActionId => {
  switch (state) {
    case "conflicted":
      return "resolve";
    case "checking":
    case "offline":
      return "retry";
    case "unauthorized":
      return "sign-in";
    case "detached":
      return "attach";
    case "unpublished":
      return "publish";
    case "diverged":
      return contested ? "compare" : "combine";
    case "ahead":
      return "push";
    case "behind":
      return "pull";
    case "attached-clean":
      return "retry";
  }
};

export interface Sync {
  readonly state: SyncState;
  readonly clocks: Clocks;
  readonly primary: SyncActionId;
  readonly reading: SyncReading;
}

export const sync = (reading: SyncReading, contested = false): Sync => {
  const state = syncStateOf(reading);
  return {
    state,
    clocks: clocksOf(reading),
    primary: primaryActionOf(state, contested),
    reading,
  };
};

export const trackingRef = (branch: string, remote = "origin"): string =>
  `refs/remotes/${remote}/${branch}`;

export const notIn = (mine: readonly Commit[], theirs: readonly Commit[]): readonly Commit[] => {
  const known = new Set<CommitId>(theirs.map((commit) => commit.id));
  return mine.filter((commit) => !known.has(commit.id));
};
