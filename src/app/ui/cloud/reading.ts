/**
 * The IO half of sync: everything `src/core/sync` needs, read out of the real
 * services in one pass.
 *
 * The split is the point. This file knows about Effect, Git, Remote, Gitea and
 * the file system; it knows nothing about what any of it MEANS. It produces a
 * `SyncReading` and an `IncomingPlan`, and the pure module decides the state,
 * the clocks and the one right button. That is what lets `/cloud` render every
 * state from a fixture with no Gitea instance in sight.
 *
 * Every git call goes through `Effect.result` and degrades to an honest empty
 * answer. A project in a browser fixture has never had `git init` run on it,
 * and the sync screen must say "this project is only on this device" rather
 * than throw — that is a state, not a fault.
 */

import { Effect, FileSystem, Option, Result } from "effect";

import { Git, type Commit } from "#core/git/git";
import { Gitea } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";
import {
  emptyPlan,
  emptyReading,
  mergeBase,
  notIn,
  surveyIncoming,
  trackingRef,
  type IncomingPlan,
  type SyncReading,
} from "#core/sync";

/** What one pass over the repository answers. */
export interface SyncFacts {
  readonly reading: SyncReading;
  readonly plan: IncomingPlan;
}

/** The branch to assume when HEAD is unborn — the one `git.init` creates. */
const DEFAULT_BRANCH = "main";

export interface ReadSyncOptions {
  /** The project's work tree. */
  readonly root: string;
  /** The Gitea host this build talks to; `null` when none is configured. */
  readonly host: string | null;
  /** `navigator.onLine`, passed in so the pure side stays testable. */
  readonly online: boolean;
  /** The last transfer's failure, from `createNetworkStatus`. */
  readonly lastFailure: SyncReading["lastFailure"];
  /** When this session last fetched; `undefined` until it has. */
  readonly fetchedAt: number | undefined;
}

/**
 * A half-finished merge, detected by the file git leaves behind.
 *
 * Reaching into `.git` is not something Sefer does casually, and the port has
 * no word for "mid-merge" — but a work tree with conflict markers in
 * scripture is the one situation where a wrong answer is unacceptable, and
 * `MERGE_HEAD` is the same marker both hosts' libraries write. The alternative
 * is a fifth `GitFailureReason` that only one caller reads.
 */
const mergeInProgress = (fileSystem: FileSystem.FileSystem, root: string): Effect.Effect<boolean> =>
  Effect.orElseSucceed(
    Effect.map(
      Effect.all([
        fileSystem.exists(`${root}/.git/MERGE_HEAD`),
        fileSystem.exists(`${root}/.git/REBASE_HEAD`),
      ]),
      ([merge, rebase]) => merge || rebase,
    ),
    () => false,
  );

/** An effect whose failure is an answer rather than a fault. */
const orEmpty = <A, E>(effect: Effect.Effect<A, E>, fallback: A): Effect.Effect<A> =>
  Effect.orElseSucceed(effect, () => fallback);

/**
 * One pass over the repository, the account and the device.
 *
 * Nothing here transfers anything: it reads what is already in the object
 * database. The cloud's side of the comparison is whatever the last fetch
 * put in the remote-tracking ref, which is why `fetchedAt` travels with the
 * reading — a screen that has not fetched says so rather than claiming the
 * shared project is empty.
 */
export const readSync = (
  options: ReadSyncOptions,
): Effect.Effect<SyncFacts, never, Git | Remote | Gitea | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const gitea = yield* Gitea;
    const fileSystem = yield* FileSystem.FileSystem;

    const base: SyncReading = {
      ...emptyReading,
      online: options.online,
      lastFailure: options.lastFailure,
      fetchedAt: options.fetchedAt,
      signedIn:
        options.host === null
          ? false
          : Option.isSome(yield* orEmpty(gitea.session(options.host), Option.none())),
    };

    const opened = yield* Effect.result(git.open(options.root));
    if (Result.isFailure(opened)) return { reading: base, plan: emptyPlan };
    const repo = opened.success;

    const origin = Option.getOrUndefined(yield* orEmpty(remote.origin(repo), Option.none()));
    const branch = Option.getOrUndefined(yield* orEmpty(git.branch(repo), Option.none()));
    const tracking = trackingRef(branch ?? DEFAULT_BRANCH);
    const remoteKnown = Option.isSome(yield* orEmpty(git.resolve(repo, tracking), Option.none()));

    // SAFETY: the fallback is the empty list, which inhabits `readonly
    // Commit[]` for any element type; the annotation only stops TypeScript
    // inferring `never[]` and then rejecting the real log.
    const empty = [] as readonly Commit[];
    const localLog = yield* orEmpty(git.log(repo), empty);
    const remoteLog = remoteKnown ? yield* orEmpty(git.logFrom(repo, tracking), empty) : empty;
    const ahead = notIn(localLog, remoteLog);
    const behind = notIn(remoteLog, localLog);
    const status = yield* orEmpty(git.status(repo), { changed: [] });

    const reading: SyncReading = {
      ...base,
      origin,
      branch,
      remoteKnown,
      localHead: localLog[0],
      remoteHead: remoteLog[0],
      ahead,
      behind,
      uncommitted: status.changed.length,
      mergeInProgress: yield* mergeInProgress(fileSystem, options.root),
    };

    if (behind.length === 0) return { reading, plan: emptyPlan };

    // The plan. `surveyIncoming` is core's, and it is core's for a reason:
    // Combine asks the same question before it runs, and the screen must not
    // be able to offer a move the program then refuses.
    const survey = yield* surveyIncoming(repo, {
      tracking,
      base: mergeBase(localLog, remoteLog),
      behind,
    });
    return { reading, plan: survey.plan };
  });
