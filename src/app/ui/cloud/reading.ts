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

import { identifyBook } from "../../../core/book/book";
import { Git, type Commit, type Repo } from "../../../core/git/git";
import { Gitea } from "../../../core/remote/gitea";
import { Remote } from "../../../core/remote/remote";
import {
  emptyPlan,
  emptyReading,
  incomingPlan,
  notIn,
  trackingRef,
  type IncomingFile,
  type IncomingPlan,
  type SyncReading,
} from "../../../core/sync";

/** What one pass over the repository answers. */
export interface SyncFacts {
  readonly reading: SyncReading;
  readonly plan: IncomingPlan;
}

/** The branch to assume when HEAD is unborn — the one `git.init` creates. */
const DEFAULT_BRANCH = "main";

/** Only scripture files get a plan; a manifest change is not a chapter. */
const USFM = /\.usfm$/iu;

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
 * The newest commit both sides hold — the merge base, near enough.
 *
 * "Near enough" is honest: this walks the two first-parent logs rather than
 * asking libgit2 for a true merge base, so a repository with criss-cross
 * merges could answer with an ancestor of the real base. The cost of that is
 * a plan that lists MORE changed chapters than strictly necessary, which is
 * the safe direction to be wrong in. `undefined` means no shared history at
 * all, and everything reads as changed on both sides.
 */
const mergeBase = (local: readonly Commit[], remote: readonly Commit[]): Commit | undefined => {
  const theirs = new Set(remote.map((commit) => commit.id));
  return local.find((commit) => theirs.has(commit.id));
};

/**
 * A blob as text, or `""` when the path did not exist at that revision.
 *
 * `TextDecoder` rather than `core/source`'s `decode`: this text is never
 * edited, saved or stamped — it is one side of a comparison, and running a
 * historical blob through the canonical-UTF-8 gate would turn "this old
 * version had a bad byte" into a failure to describe the plan at all.
 */
const textAt = (repo: Repo, rev: string, path: string): Effect.Effect<string, never, Git> =>
  Effect.orElseSucceed(
    Effect.map(
      Effect.flatMap(Git, (git) => git.show(repo, rev, path)),
      (bytes) => new TextDecoder().decode(bytes),
    ),
    () => "",
  );

/** The work tree's own copy, which may hold edits no version has recorded. */
const textHere = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  path: string,
): Effect.Effect<string> => orEmpty(fileSystem.readFileString(`${root}/${path}`), "");

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

    // The plan. Everything below reads blobs that a fetch already brought
    // down, so it costs no network and can run before the question is asked.
    const from = mergeBase(localLog, remoteLog);
    const changed = yield* orEmpty(
      git.changedPathsBetween(repo, from?.id ?? tracking, tracking),
      [],
    );
    const files: IncomingFile[] = [];
    for (const entry of changed) {
      if (!USFM.test(entry.path)) continue;
      const cloud = yield* textAt(repo, tracking, entry.path);
      const here = yield* textHere(fileSystem, options.root, entry.path);
      // With no shared history there is no base to measure from, and `""`
      // is the safe reading: every chapter counts as changed on both sides,
      // so nothing is offered as an automatic fast-forward.
      const baseText = from === undefined ? "" : yield* textAt(repo, from.id, entry.path);
      files.push({
        path: entry.path,
        bookId: identifyBook(cloud === "" ? here : cloud, entry.path),
        kind: entry.kind,
        base: baseText,
        cloud,
        here,
      });
    }

    return { reading, plan: incomingPlan(behind, files) };
  });
