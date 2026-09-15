/**
 * Combine: keep my work as one version on top of the shared project's.
 *
 * This is the diverged move, and the only one Sefer offers for a divergence.
 * It is a REPLAY, not a merge: the cloud's versions become the base, this
 * device's books are written back on top of them, and the whole lot is
 * recorded as exactly one version. No scripture text is ever merged line by
 * line — a book both sides touched refuses the entire combine before anything
 * is written, and goes to Compare where a person decides.
 *
 * The file is in two halves, and the split is what makes the policy testable:
 *
 * 1. `planCombine` is PURE. One survey in, one decision out: which paths get
 *    replayed, or which rule said no. Every refusal below is reachable in a
 *    unit test with no repository (`./combine.test.ts`).
 * 2. `combine` is the Effect program over the Git, Remote and FileSystem
 *    ports. It gathers the survey, asks the pure half, and — only if the
 *    answer is yes — performs the seven steps.
 *
 * ## The seven steps
 *
 * 1. fetch, so the cloud's head is this second's and not the screen's.
 * 2. resolve the cloud's head off the remote-tracking ref; refuse if absent.
 * 3. read this device's bytes for every locally changed path, at HEAD.
 * 4. move the branch onto the cloud's head — the work tree becomes theirs.
 * 5. write this device's bytes back over it.
 * 6. commit them as ONE version.
 * 7. push.
 *
 * ## The transaction
 *
 * Step 4 is the point of no return the ports can express, so everything that
 * could refuse happens before it and every failure after it is undone: the
 * branch goes back to the version it was on, and the forced checkout that
 * comes with `moveBranch` restores the work tree. `CombineError.state` says
 * which of three situations the repository is actually in, because "it failed"
 * is not an answer a person can act on.
 */

import { Data, Effect, FileSystem, Option, type PlatformError, Result } from "effect";

import { parentPath } from "../fileSystem/path";
import {
  type Author,
  type ChangedPath,
  type CommitId,
  Git,
  type GitError,
  type Repo,
  type SaveReceiptLike,
} from "../git/git";
import { Remote, type RemoteError } from "../remote/remote";
import { combinePlan, emptyPlan, type IncomingPlan } from "./plan";
import { notIn, trackingRef } from "./state";
import { mergeBase, surveyIncoming } from "./survey";

/**
 * Why a combine did not run. Every one of these is decided BEFORE anything is
 * written, and each is a different sentence on the screen.
 *
 * - `no-branch` — HEAD is detached or unborn; there is no branch to move.
 * - `no-work-here` — this repository has no versions to replay.
 * - `no-cloud-copy` — the shared project has no copy of this branch.
 * - `no-shared-version` — the two histories have no version in common, so
 *   there is no base to measure "what I changed" against.
 * - `not-diverged` — one of the two sides has nothing the other lacks, so the
 *   right move is an ordinary send or receive rather than a combine.
 * - `contested` — both sides changed the same file. Never merged; compared.
 * - `unrecorded-work` — files are written but not recorded as a version, and
 *   the branch move is forced: they would be discarded.
 * - `deletion` — a book was deleted on this device. `Git.commit` stages
 *   receipts, and a receipt cannot say "this file is gone", so the replay
 *   would silently resurrect it.
 * - `nothing-to-replay` — the versions on this device changed no file.
 */
export type CombineRefusal =
  | "no-branch"
  | "no-work-here"
  | "no-cloud-copy"
  | "no-shared-version"
  | "not-diverged"
  | "contested"
  | "unrecorded-work"
  | "deletion"
  | "nothing-to-replay";

/**
 * What state the repository is in when a combine fails.
 *
 * - `untouched` — nothing was written. Every refusal, and every failure up to
 *   and including the branch move.
 * - `restored` — a step after the move failed and the repository was put back
 *   on the version it was on, work tree and all. Nothing reached the cloud.
 * - `stranded` — the move happened and the restore ALSO failed. The only state
 *   that needs a person, which is why it has a word of its own.
 */
export type CombineState = "untouched" | "restored" | "stranded";

export class CombineError extends Data.TaggedError("CombineError")<{
  /** Which rule said no, or `undefined` when a port failed instead. */
  readonly refusal: CombineRefusal | undefined;
  readonly state: CombineState;
  readonly description: string;
}> {}

/** Everything `planCombine` needs, as facts rather than as ports. */
export interface CombineSurvey {
  /** The branch HEAD is on; `undefined` on a detached or unborn HEAD. */
  readonly branch: string | undefined;
  /** This device's newest version. */
  readonly localHead: CommitId | undefined;
  /** The shared project's newest version, off the remote-tracking ref. */
  readonly cloudHead: CommitId | undefined;
  /** The last version both sides hold. */
  readonly base: CommitId | undefined;
  /** Versions this device has that the cloud does not. */
  readonly ahead: number;
  /** Versions the cloud has that this device does not. */
  readonly behind: number;
  /** What would arrive — the contested books are read off this. */
  readonly incoming: IncomingPlan;
  /** Paths this device changed since the base. */
  readonly changed: readonly ChangedPath[];
  /** Paths the cloud changed since the base. */
  readonly cloudChanged: readonly ChangedPath[];
  /** Files written but not yet recorded as a version. */
  readonly uncommitted: number;
}

/** The replay, once it is allowed: exactly what gets written and recorded. */
export interface CombineReplay {
  readonly branch: string;
  /** The version this device is on now, and the one a rollback returns to. */
  readonly from: CommitId;
  /** The cloud's version the replay sits on top of. */
  readonly onto: CommitId;
  /** Repository-relative, ascending — the books written back on top. */
  readonly paths: readonly string[];
  readonly message: string;
}

export type CombineDecision =
  | { readonly ok: true; readonly replay: CombineReplay }
  | { readonly ok: false; readonly refusal: CombineRefusal; readonly detail: string };

/** The one version's message. Git-facing, so it may say what it means. */
export const combineMessage = (books: number): string =>
  books === 1
    ? "Combine: 1 book on top of the cloud"
    : `Combine: ${books} books on top of the cloud`;

const no = (refusal: CombineRefusal, detail: string): CombineDecision => ({
  ok: false,
  refusal,
  detail,
});

/**
 * The decision, as a ladder — and the order is the policy.
 *
 * It reads top to bottom as "is there a combine to do at all", then "is it
 * safe", then "can the ports express it". Contested outranks every mechanical
 * objection below it on purpose: when two people wrote the same book, that is
 * the thing to say, not that some third file happens to be unsaved.
 */
export const planCombine = (survey: CombineSurvey): CombineDecision => {
  if (survey.branch === undefined) {
    return no("no-branch", "HEAD is detached or unborn; there is no branch to move");
  }
  if (survey.localHead === undefined) {
    return no("no-work-here", "this repository has no commits to replay");
  }
  if (survey.cloudHead === undefined) {
    return no("no-cloud-copy", `${trackingRef(survey.branch)} does not exist`);
  }
  if (survey.base === undefined) {
    return no(
      "no-shared-version",
      "the two histories have no commit in common; there is no base to replay from",
    );
  }

  const proposal = combinePlan(survey.ahead, survey.behind, survey.incoming);
  if (!proposal.safe) {
    if (proposal.contested.length > 0) {
      return no("contested", `both sides changed ${proposal.contested.join(", ")}`);
    }
    return no("not-diverged", `not a divergence: ${survey.ahead} ahead, ${survey.behind} behind`);
  }

  // Scripture is settled by the book-level check above; this catches
  // everything else two people can both have touched — a manifest, a
  // versification file — where "keep mine" would be a silent decision rather
  // than a stated one.
  const theirs = new Set(survey.cloudChanged.map((entry) => entry.path));
  const both = survey.changed.filter((entry) => theirs.has(entry.path)).map((entry) => entry.path);
  if (both.length > 0) return no("contested", `both sides changed ${both.join(", ")}`);

  if (survey.uncommitted > 0) {
    return no(
      "unrecorded-work",
      `${survey.uncommitted} file(s) are written but not recorded; the branch move would discard them`,
    );
  }

  const deleted = survey.changed
    .filter((entry) => entry.kind === "deleted")
    .map((entry) => entry.path);
  if (deleted.length > 0) {
    return no("deletion", `a replay cannot carry a deletion: ${deleted.join(", ")}`);
  }

  const paths = survey.changed.map((entry) => entry.path).sort((a, b) => a.localeCompare(b));
  if (paths.length === 0) {
    return no("nothing-to-replay", "the versions on this device changed no file");
  }

  return {
    ok: true,
    replay: {
      branch: survey.branch,
      from: survey.localHead,
      onto: survey.cloudHead,
      paths,
      message: combineMessage(paths.length),
    },
  };
};

/** What a combine leaves behind when it works. */
export interface CombineResult {
  /** The one version it recorded. */
  readonly commit: CommitId;
  /** The cloud version it sits on. */
  readonly onto: CommitId;
  /** The version this device was on before. */
  readonly from: CommitId;
  readonly paths: readonly string[];
}

/** A port failure, carrying its reason forward so the shell can classify it. */
const fromPort =
  (state: CombineState) =>
  (error: GitError | RemoteError): CombineError =>
    new CombineError({
      refusal: undefined,
      state,
      description: `${error.reason}: ${error.description ?? "no detail"}`,
    });

const fromDisk =
  (state: CombineState) =>
  (error: PlatformError.PlatformError): CombineError =>
    new CombineError({ refusal: undefined, state, description: String(error) });

export interface CombineOptions {
  /** The project's work tree. */
  readonly root: string;
  /** Who the one version is by. */
  readonly author: Author;
}

/**
 * Everything `planCombine` needs, read out of one repository.
 *
 * Shared by the preview and the move itself so the screen cannot offer a
 * combine the program then refuses — the only difference between the two is
 * that the move has fetched first.
 */
const gather = (
  repo: Repo,
): Effect.Effect<CombineDecision, CombineError, Git | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const untouched = fromPort("untouched");

    const branch = Option.getOrUndefined(yield* Effect.mapError(git.branch(repo), untouched));
    const tracking = branch === undefined ? undefined : trackingRef(branch);
    // 2. The cloud's head. `None` is an answer — "nothing has been sent yet" —
    // so it becomes a refusal rather than a fault.
    const cloudHead =
      tracking === undefined
        ? undefined
        : Option.getOrUndefined(yield* Effect.mapError(git.resolve(repo, tracking), untouched));

    const localLog = yield* Effect.mapError(git.log(repo), untouched);
    const remoteLog =
      tracking === undefined || cloudHead === undefined
        ? []
        : yield* Effect.mapError(git.logFrom(repo, tracking), untouched);
    const base = mergeBase(localLog, remoteLog);
    const localHead = localLog[0]?.id;

    const incoming =
      tracking === undefined || base === undefined
        ? undefined
        : yield* surveyIncoming(repo, { tracking, base, behind: notIn(remoteLog, localLog) });
    const status = yield* Effect.mapError(git.status(repo), untouched);
    // What THIS device changed since the base: the same walk the incoming plan
    // does, in the other direction.
    const changed =
      base === undefined || localHead === undefined
        ? []
        : yield* Effect.mapError(git.changedPathsBetween(repo, base.id, localHead), untouched);

    return planCombine({
      branch,
      localHead,
      cloudHead,
      base: base?.id,
      ahead: notIn(localLog, remoteLog).length,
      behind: notIn(remoteLog, localLog).length,
      incoming: incoming?.plan ?? emptyPlan,
      changed,
      cloudChanged: incoming?.changed ?? [],
      uncommitted: status.changed.length,
    });
  });

/**
 * The decision, off what is already in the object database.
 *
 * Reads only, and no network: this is what a screen asks before it puts the
 * question to a person, so the confirmation can name the actual books. It is
 * not the authority — `combine` fetches and asks again, because the cloud may
 * have moved between the dialog opening and the button being pressed.
 */
export const previewCombine = (
  root: string,
): Effect.Effect<CombineDecision, CombineError, Git | FileSystem.FileSystem> =>
  Effect.flatMap(
    Effect.flatMap(Git, (git) => Effect.mapError(git.open(root), fromPort("untouched"))),
    gather,
  );

/**
 * The whole move, over the ports.
 *
 * Everything before the branch move is a read, so a refusal or a failed fetch
 * leaves the repository exactly as it was. Everything after it is inside one
 * rollback: if writing, recording or sending fails, the branch goes back and
 * the forced checkout restores the work tree, and the error says so.
 */
export const combine = (
  options: CombineOptions,
): Effect.Effect<CombineResult, CombineError, Git | Remote | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const fileSystem = yield* FileSystem.FileSystem;
    const untouched = fromPort("untouched");

    const repo: Repo = yield* Effect.mapError(git.open(options.root), untouched);

    // 1. Ask the shared project what it has NOW. The screen's reading may be
    // minutes old, and a combine onto a stale head is the one way this move
    // could lose somebody else's version.
    yield* Effect.mapError(remote.fetch(repo), untouched);

    const decision = yield* gather(repo);
    if (!decision.ok) {
      return yield* Effect.fail(
        new CombineError({
          refusal: decision.refusal,
          state: "untouched",
          description: decision.detail,
        }),
      );
    }
    const replay = decision.replay;

    // 3. This device's bytes, read out of the object database while they are
    // still reachable — after the move the work tree no longer holds them.
    const held: { readonly path: string; readonly bytes: Uint8Array }[] = [];
    for (const path of replay.paths) {
      held.push({
        path,
        bytes: yield* Effect.mapError(git.show(repo, replay.from, path), untouched),
      });
    }

    // 4. The point of no return: the work tree becomes the cloud's.
    yield* Effect.mapError(remote.moveBranch(repo, replay.branch, replay.onto), untouched);

    const rest = Effect.gen(function* () {
      const failed = fromDisk("restored");
      // 5. Write this device's books back over the cloud's.
      for (const file of held) {
        const full = `${repo.root}/${file.path}`;
        yield* Effect.mapError(
          fileSystem.makeDirectory(parentPath(full), { recursive: true }),
          failed,
        );
        yield* Effect.mapError(fileSystem.writeFile(full, file.bytes), failed);
      }
      // 6. Exactly one version. The receipts are the paths just written, which
      // is the rule Save commits under too: nothing rides along.
      const receipts: readonly SaveReceiptLike[] = held.map((file) => ({
        path: file.path,
        // The port carries a stamp only to keep a receipt recognisable at a
        // glance; the length is the one field that is true of committed bytes.
        stamp: { revision: 0, length: file.bytes.length },
      }));
      const commit = yield* Effect.mapError(
        git.commit(repo, receipts, replay.message, options.author),
        fromPort("restored"),
      );
      // 7. Nothing on the cloud changed until this line.
      yield* Effect.mapError(remote.push(repo), fromPort("restored"));
      return commit;
    });

    const outcome = yield* Effect.result(rest);
    if (Result.isFailure(outcome)) {
      const failure = outcome.failure;
      const undone = yield* Effect.result(remote.moveBranch(repo, replay.branch, replay.from));
      if (Result.isFailure(undone)) {
        return yield* Effect.fail(
          new CombineError({
            refusal: undefined,
            state: "stranded",
            description: `${failure.description}; and putting the branch back on ${replay.from} failed: ${undone.failure.reason}`,
          }),
        );
      }
      return yield* Effect.fail(
        new CombineError({
          refusal: undefined,
          state: "restored",
          description: failure.description,
        }),
      );
    }

    return {
      commit: outcome.success,
      onto: replay.onto,
      from: replay.from,
      paths: replay.paths,
    };
  });
