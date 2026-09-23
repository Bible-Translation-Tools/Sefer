/**
 * The sync state machine: one reading of a repository in, one state out.
 *
 * Pure: the shell does the IO (`src/app/ui/cloud/reading.ts`), hands the facts
 * in, and renders what comes back, so every state is reachable from a dev
 * fixture without a Gitea instance. The two clocks and the rule that scripture
 * text is never merged automatically are in
 * `documentation/architecture/sync.md`.
 */

import type { Commit, CommitId } from "../git/git";
import type { RemoteFailureReason } from "../remote/remote";

/**
 * Where this project stands with its cloud copy.
 *
 * - `detached` — nothing is attached: this project has no `origin` yet.
 * - `unpublished` — attached, but the cloud has no copy of this branch. The
 *   repository exists and is empty, which is the ordinary state right after
 *   someone creates one in Gitea.
 * - `attached-clean` — both sides hold the same versions.
 * - `ahead` — this device has versions the cloud does not.
 * - `behind` — the cloud has versions this device does not.
 * - `diverged` — both are true: each side recorded work the other has not seen.
 * - `conflicted` — a transfer stopped part-way and the work tree is mid-merge.
 *   Nothing else may run until that is settled.
 * - `offline` — the device has no network, or the last transfer failed on the
 *   way out. Not an error: the work is safe on disk and will go when it can.
 * - `unauthorized` — there is no session for the cloud, or it was rejected.
 */
export type SyncState =
  | "detached"
  | "unpublished"
  | "attached-clean"
  | "ahead"
  | "behind"
  | "diverged"
  | "conflicted"
  | "offline"
  | "unauthorized";

/**
 * One side's clock.
 *
 * `at` is when that side last recorded ANY version — the answer to "when did
 * this last move" — and `unshared` is how many of its versions the other side
 * has not got. They are deliberately separate numbers: a project can be
 * perfectly in sync and still have last moved a month ago, and that is worth
 * saying.
 */
export interface Clock {
  /** Milliseconds since the epoch; `undefined` when this side has no versions. */
  readonly at: number | undefined;
  /** Versions this side holds that the other does not. */
  readonly unshared: number;
  /**
   * Who recorded the newest version on this side, when that is worth saying.
   *
   * v1's rule, kept: the SHARED line names the person, and the local line
   * never does — we already know who that was. Absent rather than stale: an
   * attribution left over from a previous reading is worse than none.
   */
  readonly by: string | undefined;
}

export interface Clocks {
  /** This device. `unshared` is how far ahead it is. */
  readonly local: Clock;
  /** The cloud. `unshared` is how far behind this device is. */
  readonly shared: Clock;
}

/**
 * The facts the shell reads out of Git, Remote, Gitea and the browser, in the
 * one shape the derivation needs.
 *
 * `fetchedAt` matters: `behind` can only be believed after a fetch, and a
 * reading taken before one honestly reports `undefined` rather than claiming
 * the cloud is empty. Everything else is a plain answer to a plain question.
 */
export interface SyncReading {
  /** The `origin` URL recorded for this project, or `undefined` when none is. */
  readonly origin: string | undefined;
  /** The branch HEAD is on; `undefined` on a detached or unborn HEAD. */
  readonly branch: string | undefined;
  /** Is there a live session for the cloud host? */
  readonly signedIn: boolean;
  /** `navigator.onLine`, as the device reports it. */
  readonly online: boolean;
  /** When the remote-tracking ref was last refreshed; `undefined` = never. */
  readonly fetchedAt: number | undefined;
  /** Did the remote-tracking ref exist at all? False = the cloud is empty. */
  readonly remoteKnown: boolean;
  /** The newest local commit, or `undefined` in a repository with no commits. */
  readonly localHead: Commit | undefined;
  /** The newest commit on the remote-tracking ref. */
  readonly remoteHead: Commit | undefined;
  /** Local commits the cloud does not have, newest first. */
  readonly ahead: readonly Commit[];
  /** Cloud commits this device does not have, newest first. */
  readonly behind: readonly Commit[];
  /** Files written but not yet recorded as a version. */
  readonly uncommitted: number;
  /** Is a merge or rebase part-way through in the work tree? */
  readonly mergeInProgress: boolean;
  /** Why the last transfer failed, when one did and nothing has succeeded since. */
  readonly lastFailure: RemoteFailureReason | undefined;
}

/** A reading with nothing in it — the starting point every builder patches. */
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
};

/**
 * The derivation, as a ladder rather than a graph.
 *
 * Order is the whole policy, so it is written once, here, and each rung says
 * why it outranks the ones below it:
 *
 * 1. `conflicted` first — a half-finished merge makes every other answer a
 *    lie, and it is the one state a person can settle with no network.
 * 2. `offline` next — while the device cannot reach anything, "you are three
 *    versions ahead" is true but not actionable, and the clocks still say it.
 * 3. `unauthorized` — reachable but not allowed in. Distinguished from offline
 *    because only one of the two is worth retrying unchanged.
 * 4. `detached` — nothing to be ahead OF.
 * 5. `unpublished` — attached to a repository the branch has never reached.
 * 6. the clocks — diverged, ahead, behind, clean.
 */
const syncStateOf = (reading: SyncReading): SyncState => {
  if (reading.mergeInProgress) return "conflicted";
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
    // Named only when there is something of theirs to receive. With nothing
    // incoming the last cloud committer was probably this device.
    by: reading.behind.length > 0 ? reading.remoteHead?.author.name : undefined,
  },
});

/**
 * The one right thing to offer for a state.
 *
 * Every screen showing sync has exactly one primary button, and this decides
 * which. Ids, not labels: the words are the shell's business (`src/app/i18n`),
 * and core has no catalogue.
 *
 * - `sign-in` — go get a session.
 * - `attach` — pick a repository for this project.
 * - `publish` — create the cloud copy and send the first version.
 * - `pull` — take the cloud's versions. Behind a confirmed plan, always.
 * - `push` — send this device's versions.
 * - `combine` — squash this device's work onto the cloud's, the diverged move.
 * - `compare` — the diverged move when both sides touched the same book: a
 *   person decides, in the Compare screen, and no text is merged here.
 * - `resolve` — finish the merge that is part-way through.
 * - `retry` — try the thing that failed, unchanged.
 */
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

/**
 * `contested` is whether the two sides touched the same book — the caller
 * computes it from an `IncomingPlan` (`./plan.ts`) and it changes exactly one
 * answer: a diverged project with contested books is sent to Compare instead
 * of being offered a combine that would have to guess.
 */
const primaryActionOf = (state: SyncState, contested = false): SyncActionId => {
  switch (state) {
    case "conflicted":
      return "resolve";
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
      // Nothing is owed, but asking the cloud is always allowed — and it is
      // the only honest button when both clocks agree.
      return "retry";
  }
};

/** The whole answer, as one value a component can render without re-deriving. */
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

/**
 * Does this state want the incoming plan computed?
 *
 * Only two do, and both for the same reason: something is arriving, and a
 * translator gets to read what it will change before it lands.
 */
export const wantsPlan = (state: SyncState): boolean => state === "behind" || state === "diverged";

/** The remote-tracking ref a branch's cloud copy lives at. */
export const trackingRef = (branch: string, remote = "origin"): string =>
  `refs/remotes/${remote}/${branch}`;

/**
 * Commits on `mine` that are not on `theirs`, newest first.
 *
 * Set difference over ids rather than a merge-base walk, and that is the
 * pessimistic reading on purpose: two histories with no common ancestor come
 * out fully ahead AND fully behind, which is `diverged` — v1's rule, learned
 * the hard way. An optimistic answer there would offer a fast-forward that
 * silently discards one side.
 */
export const notIn = (mine: readonly Commit[], theirs: readonly Commit[]): readonly Commit[] => {
  const known = new Set<CommitId>(theirs.map((commit) => commit.id));
  return mine.filter((commit) => !known.has(commit.id));
};
