import { Effect, FileSystem, Option, Result } from "effect";

import type { Galley } from "#core/galley";
import { DEFAULT_BRANCH, Git, type Commit } from "#core/git/git";
import type { Project } from "#core/project/project";
import { Gitea } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";
import {
  emptyReading,
  mergeBase,
  notIn,
  surveyIncoming,
  trackingRef,
  type IncomingPlan,
  type SyncReading,
} from "#core/sync";

import { copyRef } from "../../suggestions";
import type { CollabMode } from "../../syncSettings";

export interface SyncFacts {
  readonly reading: SyncReading;
  readonly plan: IncomingPlan;
}

export interface SyncSurvey {
  readonly reading: SyncReading;
  readonly plan:
    | Effect.Effect<IncomingPlan, never, Git | FileSystem.FileSystem | Galley>
    | undefined;
}

export interface ReadSyncOptions {
  readonly root: string;
  readonly project: Project;
  readonly host: string | null;
  readonly online: boolean;
  readonly lastFailure: SyncReading["lastFailure"];
  readonly checking: boolean;
  readonly sendRefused: boolean;
  readonly fetchedAt: number | undefined;
  readonly chosenMode?: CollabMode | undefined;
}

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

const orEmpty = <A, E>(effect: Effect.Effect<A, E>, fallback: A): Effect.Effect<A> =>
  Effect.orElseSucceed(effect, () => fallback);

export const readSync = (
  options: ReadSyncOptions,
): Effect.Effect<SyncSurvey, never, Git | Remote | Gitea | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const gitea = yield* Gitea;
    const fileSystem = yield* FileSystem.FileSystem;

    const base: SyncReading = {
      ...emptyReading,
      online: options.online,
      lastFailure: options.lastFailure,
      checking: options.checking,
      sendRefused: options.sendRefused,
      fetchedAt: options.fetchedAt,
      signedIn:
        options.host === null
          ? false
          : Option.isSome(yield* orEmpty(gitea.session(options.host), Option.none())),
    };

    const opened = yield* Effect.result(git.open(options.root));
    if (Result.isFailure(opened)) return { reading: base, plan: undefined };
    const repo = opened.success;

    const origin = Option.getOrUndefined(yield* orEmpty(remote.origin(repo), Option.none()));
    const branch = Option.getOrUndefined(yield* orEmpty(git.branch(repo), Option.none()));
    const tracking = trackingRef(branch ?? DEFAULT_BRANCH);
    const remoteKnown = Option.isSome(yield* orEmpty(git.resolve(repo, tracking), Option.none()));

    // SAFETY: the fallback is the empty list, which inhabits `readonly Commit[]` for any element type; the annotation only stops TypeScript inferring `never[]` and then rejecting the real log.
    const empty = [] as readonly Commit[];
    const localLog = yield* orEmpty(git.log(repo), empty);
    const remoteLog = remoteKnown ? yield* orEmpty(git.logFrom(repo, tracking), empty) : empty;
    const copyUrl = Option.getOrUndefined(
      yield* orEmpty(remote.urlOf(repo, "copy"), Option.none()),
    );
    const me =
      options.host === null
        ? undefined
        : Option.getOrUndefined(yield* orEmpty(gitea.session(options.host), Option.none()))
            ?.username;
    const copyOwner = copyUrl
      ?.replace(/\.git$/u, "")
      .split("/")
      .at(-2);
    const copyAttached =
      me !== undefined && copyOwner !== undefined && me.toLowerCase() === copyOwner.toLowerCase();
    const inCopyMode = (options.chosenMode ?? (copyAttached ? "copy" : "shared")) === "copy";
    const copied = copyRef(branch ?? DEFAULT_BRANCH);
    const copyKnown =
      inCopyMode && Option.isSome(yield* orEmpty(git.resolve(repo, copied), Option.none()));
    const sentLog = copyKnown ? yield* orEmpty(git.logFrom(repo, copied), empty) : remoteLog;
    const ahead = notIn(localLog, sentLog);
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

    if (behind.length === 0) return { reading, plan: undefined };

    const plan = Effect.map(
      surveyIncoming(repo, {
        tracking,
        base: mergeBase(localLog, remoteLog),
        behind,
        project: options.project,
      }),
      (survey) => survey.plan,
    );
    return { reading, plan };
  });
