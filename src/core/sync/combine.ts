/**
 * Combine: join the shared project's work and this device's, as one decision
 * commit, and send it.
 *
 * This is the diverged move. Both sides have commits the other lacks, and
 * neither side's history is rewritten: the commit Combine records has TWO
 * parents — this device's tip and the shared project's — and its files are
 * the final text. Nothing is replayed, nothing is rebased, git's merge never
 * runs, and sending the result is a fast-forward on every remote that holds
 * either tip. Only the final text matters.
 *
 * What the final text is, per file:
 *
 * - changed only on this device — this device's, as HEAD already holds it;
 * - changed only on the other side — theirs, written into the work tree and
 *   into the Book;
 * - changed on both — never here. The policy sends that book to a person
 *   (Compare), and the whole combine refuses before anything is written.
 *
 * The file is in two halves, and the split is what makes the policy testable:
 *
 * 1. `planCombine` is PURE. One survey in, one decision out: which paths
 *    arrive, or which rule said no.
 * 2. `combine` is the Effect program over the ports: fetch, gather, ask the
 *    pure half, and — only if it says yes — write, record and send, in the
 *    repository's exclusive lane.
 */

import { Data, Effect, FileSystem, Option, type PlatformError, Result } from "effect";

import type { BookId } from "../book/book";
import { parentPath } from "../fileSystem/path";
import type { Galley } from "../galley";
import {
  type Author,
  type ChangedPath,
  type CommitId,
  Git,
  type GitError,
  type Repo,
  type SaveReceiptLike,
} from "../git/git";
import { Repositories } from "../git/repository";
import type { Project } from "../project/project";
import { Remote, type RemoteError } from "../remote/remote";
import { SaveCoordinator } from "../save/saveCoordinator";
import type { SourceStamp } from "../source/source";
import { booksByPath, classify, isScripture } from "./classify";
import { DEFAULT_OVERLAP, judge, type Overlap } from "./policy";
import { notIn, trackingRef } from "./state";

/**
 * Why a combine did not run. Every one of these is decided BEFORE anything is
 * written, and each is a different sentence on the screen.
 *
 * - `no-branch` — HEAD is detached or unborn; there is no branch to join onto.
 * - `no-work-here` — this repository has no commits.
 * - `no-cloud-copy` — the shared project has no copy of this branch.
 * - `no-shared-version` — the two histories have no commit in common, so
 *   there is no base to measure "what I changed" against.
 * - `not-diverged` — one of the two sides has nothing the other lacks, so the
 *   right move is an ordinary send or receive rather than a combine.
 * - `contested` — both sides changed the same file. Never merged; compared.
 * - `deletion` — the other side deleted a file. `Git.commit` stages receipts,
 *   and a receipt cannot say "this file is gone".
 */
export type CombineRefusal =
  | "no-branch"
  | "no-work-here"
  | "no-cloud-copy"
  | "no-shared-version"
  | "not-diverged"
  | "contested"
  | "deletion";

/**
 * What state the repository is in when a combine fails.
 *
 * - `untouched` — nothing was written. Every refusal, and every failure up to
 *   the first write.
 * - `restored` — the other side's files were written, the commit failed, and
 *   those files were put back as they were. Nothing was recorded or sent.
 * - `recorded` — the combination is recorded on this device, and sending it
 *   failed. Nothing is lost; the next send carries it.
 * - `stranded` — the commit failed AND putting the files back failed too. The
 *   only state that needs a person, which is why it has a word of its own.
 */
export type CombineState = "untouched" | "restored" | "recorded" | "stranded";

export class CombineError extends Data.TaggedError("CombineError")<{
  /** Which rule said no, or `undefined` when a port failed instead. */
  readonly refusal: CombineRefusal | undefined;
  readonly state: CombineState;
  readonly description: string;
}> {}

/** Everything `planCombine` needs, as facts rather than as ports. */
interface CombineSurvey {
  /** The branch HEAD is on; `undefined` on a detached or unborn HEAD. */
  readonly branch: string | undefined;
  /** This device's newest commit. */
  readonly localHead: CommitId | undefined;
  /** The shared project's newest commit, off the remote-tracking ref. */
  readonly cloudHead: CommitId | undefined;
  /** The best common ancestor of the two. */
  readonly base: CommitId | undefined;
  /** Commits this device has that the cloud does not. */
  readonly ahead: number;
  /** Commits the cloud has that this device does not. */
  readonly behind: number;
  /** Paths this device changed since the base, committed. */
  readonly changed: readonly ChangedPath[];
  /** Paths the cloud changed since the base. */
  readonly cloudChanged: readonly ChangedPath[];
  /** Paths with changes no commit holds yet. */
  readonly unrecorded: readonly string[];
  /** Scripture books the policy sends to a person. */
  readonly review: readonly string[];
}

/** The combination, once it is allowed: exactly what arrives and what is recorded. */
export interface CombineReplay {
  readonly branch: string;
  /** This device's tip: the decision commit's first parent. */
  readonly from: CommitId;
  /** The shared project's tip: its second. */
  readonly onto: CommitId;
  /** Repository-relative, ascending — what this device changed, which stays. */
  readonly paths: readonly string[];
  /** Repository-relative, ascending — what the other side changed, which arrives. */
  readonly taking: readonly string[];
  readonly message: string;
}

type CombineDecision =
  | { readonly ok: true; readonly replay: CombineReplay }
  | { readonly ok: false; readonly refusal: CombineRefusal; readonly detail: string };

/** The decision commit's message. Git-facing, so it may say what it means. */
export const combineMessage = (books: number): string =>
  books === 1
    ? "Combined with the shared project: 1 book"
    : `Combined with the shared project: ${books} books`;

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
 * the thing to say.
 */
const planCombine = (survey: CombineSurvey): CombineDecision => {
  if (survey.branch === undefined) {
    return no("no-branch", "HEAD is detached or unborn; there is no branch to join onto");
  }
  if (survey.localHead === undefined) {
    return no("no-work-here", "this repository has no commits");
  }
  if (survey.cloudHead === undefined) {
    return no("no-cloud-copy", `${trackingRef(survey.branch)} does not exist`);
  }
  if (survey.base === undefined) {
    return no("no-shared-version", "the two histories have no commit in common");
  }
  if (survey.ahead === 0 || survey.behind === 0) {
    return no("not-diverged", `not a divergence: ${survey.ahead} ahead, ${survey.behind} behind`);
  }
  if (survey.review.length > 0) {
    return no("contested", `both sides changed ${survey.review.join(", ")}`);
  }
  // Scripture is settled by the policy above; this catches every other file
  // two people can both have touched — a manifest, a versification file, or
  // one with changes here no commit holds — where taking theirs would be a
  // silent decision rather than a stated one.
  const mine = new Set([...survey.changed.map((entry) => entry.path), ...survey.unrecorded]);
  const both = survey.cloudChanged
    .filter((entry) => !isScripture(entry.path) && mine.has(entry.path))
    .map((entry) => entry.path);
  if (both.length > 0) return no("contested", `both sides changed ${both.join(", ")}`);

  const deleted = survey.cloudChanged
    .filter((entry) => entry.kind === "deleted")
    .map((entry) => entry.path);
  if (deleted.length > 0) {
    return no("deletion", `a combine cannot carry a deletion yet: ${deleted.join(", ")}`);
  }

  const taking = survey.cloudChanged.map((entry) => entry.path).sort((a, b) => a.localeCompare(b));
  const paths = survey.changed.map((entry) => entry.path).sort((a, b) => a.localeCompare(b));
  const books = new Set([...paths, ...taking].filter(isScripture)).size;
  return {
    ok: true,
    replay: {
      branch: survey.branch,
      from: survey.localHead,
      onto: survey.cloudHead,
      paths,
      taking,
      message: combineMessage(books),
    },
  };
};

/** What a combine leaves behind when it works. */
export interface CombineResult {
  /** The decision commit. */
  readonly commit: CommitId;
  readonly onto: CommitId;
  readonly from: CommitId;
  readonly paths: readonly string[];
  readonly taking: readonly string[];
  /** Books handed the other side's text. */
  readonly reloaded: readonly BookId[];
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
  /** The open project: its Books are "mine", and the ones a combine reloads. */
  readonly project: Project;
  /** Who the decision commit is by. */
  readonly author: Author;
  readonly overlap?: Overlap;
  /**
   * A person has just reviewed against the shared project: a book the policy
   * would send to a person is decided already, and its text in the editor is
   * the decision — saved and recorded as this side's, never overwritten by
   * the other side's file.
   */
  readonly reviewed?: boolean;
}

interface Gathered {
  readonly decision: CombineDecision;
  /** Books a person decided in Review, by path: kept as the editor holds them. */
  readonly decided: readonly string[];
  /** The stamp each Book's Source had when it was classified. */
  readonly stamps: ReadonlyMap<string, SourceStamp>;
}

/**
 * Everything `planCombine` needs, read out of one repository and the Books.
 *
 * Shared by the preview and the move itself so the screen cannot offer a
 * combine the program then refuses — the only difference between the two is
 * that the move has fetched first.
 */
const gather = (
  repo: Repo,
  project: Project,
  overlap: Overlap,
  reviewed = false,
): Effect.Effect<Gathered, CombineError, Git | FileSystem.FileSystem | Galley> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const untouched = fromPort("untouched");

    const branch = Option.getOrUndefined(yield* Effect.mapError(git.branch(repo), untouched));
    const tracking = branch === undefined ? undefined : trackingRef(branch);
    // The cloud's head. `None` is an answer — "nothing has been sent yet" —
    // so it becomes a refusal rather than a fault.
    const cloudHead =
      tracking === undefined
        ? undefined
        : Option.getOrUndefined(yield* Effect.mapError(git.resolve(repo, tracking), untouched));
    const localHead = Option.getOrUndefined(
      yield* Effect.mapError(git.resolve(repo, "HEAD"), untouched),
    );
    const base =
      localHead === undefined || cloudHead === undefined
        ? undefined
        : Option.getOrUndefined(
            yield* Effect.mapError(git.mergeBase(repo, localHead, cloudHead), untouched),
          );

    const localLog =
      localHead === undefined ? [] : yield* Effect.mapError(git.log(repo), untouched);
    const remoteLog =
      tracking === undefined || cloudHead === undefined
        ? []
        : yield* Effect.mapError(git.logFrom(repo, tracking), untouched);

    const changed =
      base === undefined || localHead === undefined
        ? []
        : yield* Effect.mapError(git.changedPathsBetween(repo, base, localHead), untouched);
    const cloudChanged =
      base === undefined || cloudHead === undefined
        ? []
        : yield* Effect.mapError(git.changedPathsBetween(repo, base, cloudHead), untouched);
    const status = yield* Effect.mapError(git.status(repo), untouched);

    const books = booksByPath(repo, project);
    const classified =
      base === undefined || cloudHead === undefined
        ? { facts: [], stamps: new Map<string, SourceStamp>() }
        : yield* classify(repo, books, base, cloudHead, cloudChanged);
    const verdicts = judge(classified.facts, overlap);
    // `combine` would need a unit-level merge, which Sefer does not do by
    // itself: below the book scope it still goes to a person here.
    const needsPerson = classified.facts.filter(
      (_, index) => verdicts[index] === "review" || verdicts[index] === "combine",
    );
    const decided = reviewed ? needsPerson.map((book) => book.path) : [];
    const review = reviewed ? [] : needsPerson.map((book) => book.bookId);

    return {
      decided,
      decision: planCombine({
        branch,
        localHead,
        cloudHead,
        base,
        ahead: notIn(localLog, remoteLog).length,
        behind: notIn(remoteLog, localLog).length,
        changed,
        // A decided book is this side's: it is not taken from the other side,
        // and its saved-but-unrecorded file is the decision, not a conflict.
        cloudChanged: cloudChanged.filter((entry) => !decided.includes(entry.path)),
        unrecorded: status.changed
          .map((entry) => entry.path)
          .filter((path) => !decided.includes(path)),
        review,
      }),
      stamps: classified.stamps,
    };
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
  project: Project,
): Effect.Effect<CombineDecision, CombineError, Git | FileSystem.FileSystem | Galley> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const repo = yield* Effect.mapError(git.open(project.root), fromPort("untouched"));
    return (yield* gather(repo, project, DEFAULT_OVERLAP)).decision;
  });

/**
 * The whole move, in the repository's exclusive lane.
 *
 * Everything before the first write is a read, so a refusal or a failed fetch
 * leaves the repository exactly as it was. The other side's files are then
 * written and recorded; if recording fails they are put back. Once recorded,
 * the Books take the new text, and a failed send leaves a combination that
 * the next send carries.
 */
export const combine = (
  options: CombineOptions,
): Effect.Effect<
  CombineResult,
  CombineError,
  Git | Remote | Repositories | SaveCoordinator | FileSystem.FileSystem | Galley
> =>
  Effect.gen(function* () {
    const repositories = yield* Repositories;
    return yield* Effect.catchTag(
      repositories.exclusive(options.project.root, "combine", program(options)),
      "RepositoryError",
      (error) =>
        Effect.fail(
          new CombineError({
            refusal: undefined,
            state: "untouched",
            description: error.description,
          }),
        ),
    );
  });

const program = (options: CombineOptions) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const save = yield* SaveCoordinator;
    const fileSystem = yield* FileSystem.FileSystem;
    const untouched = fromPort("untouched");
    const project = options.project;

    const repo: Repo = yield* Effect.mapError(git.open(project.root), untouched);

    // Ask the shared project what it has NOW. The screen's reading may be
    // minutes old, and a combine onto a stale head is the one way this move
    // could lose somebody else's commit.
    yield* Effect.mapError(remote.fetch(repo), untouched);

    const gathered = yield* gather(
      repo,
      project,
      options.overlap ?? DEFAULT_OVERLAP,
      options.reviewed === true,
    );
    const decision = gathered.decision;
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

    // What each arriving file holds now (HEAD's bytes, or nothing), so a
    // failed commit can put the work tree back exactly.
    const before: { readonly path: string; readonly bytes: Uint8Array | undefined }[] = [];
    const arriving: { readonly path: string; readonly bytes: Uint8Array }[] = [];
    for (const path of replay.taking) {
      before.push({
        path,
        bytes: yield* Effect.orElseSucceed(
          Effect.map(git.show(repo, replay.from, path), (bytes): Uint8Array | undefined => bytes),
          () => undefined,
        ),
      });
      arriving.push({
        path,
        bytes: yield* Effect.mapError(git.show(repo, replay.onto, path), untouched),
      });
    }

    const write = (path: string, bytes: Uint8Array) =>
      Effect.gen(function* () {
        const full = `${repo.root}/${path}`;
        yield* fileSystem.makeDirectory(parentPath(full), { recursive: true });
        yield* fileSystem.writeFile(full, bytes);
      });

    // The decided books' text goes to their files first, through Save, so
    // the decision commit records exactly what the person chose.
    const books = booksByPath(repo, project);
    const decidedBooks = gathered.decided.flatMap((path) => {
      const book = books.get(path);
      return book === undefined ? [] : [book];
    });
    yield* Effect.mapError(
      save.saveAll(decidedBooks),
      (error) =>
        new CombineError({
          refusal: undefined,
          state: "untouched",
          description: error.description ?? error.reason,
        }),
    );

    const recorded = yield* Effect.result(
      Effect.gen(function* () {
        for (const file of arriving)
          yield* Effect.mapError(write(file.path, file.bytes), fromDisk("restored"));
        // The receipts are the paths just written: nothing rides along. With
        // none, the commit is the join alone, which is what it records.
        const receipts: readonly SaveReceiptLike[] = [
          ...arriving.map((file) => ({
            path: file.path,
            // The port carries a stamp only to keep a receipt recognisable at
            // a glance; the length is the one field true of these bytes.
            stamp: { revision: 0, length: file.bytes.length },
          })),
          ...decidedBooks.map((book) => ({ path: book.path, stamp: book.source().stamp })),
        ];
        return yield* Effect.mapError(
          git.commit(repo, receipts, replay.message, options.author, {
            alsoParents: [replay.onto],
          }),
          fromPort("restored"),
        );
      }),
    );
    if (Result.isFailure(recorded)) {
      const failure = recorded.failure;
      const undone = yield* Effect.result(
        Effect.forEach(before, (file) =>
          file.bytes === undefined
            ? fileSystem.remove(`${repo.root}/${file.path}`, { force: true })
            : write(file.path, file.bytes),
        ),
      );
      return yield* Effect.fail(
        Result.isFailure(undone)
          ? new CombineError({
              refusal: undefined,
              state: "stranded",
              description: `${failure.description}; and putting the files back failed: ${String(undone.failure)}`,
            })
          : new CombineError({
              refusal: undefined,
              state: "restored",
              description: failure.description,
            }),
      );
    }

    // The Books take what arrived. A Book typed into since the gather keeps
    // its text; its baseline still moves, so Save & Review shows the change.
    const reloaded: BookId[] = [];
    for (const path of replay.taking) {
      const book = books.get(path);
      if (book === undefined) continue;
      const applied = yield* Effect.orElseSucceed(
        save.takeDisk(book, "incoming", gathered.stamps.get(path)),
        () => false,
      );
      if (applied) reloaded.push(book.id);
    }

    // Nothing on the cloud changed until this line.
    yield* Effect.mapError(remote.push(repo), fromPort("recorded"));
    return {
      commit: recorded.success,
      onto: replay.onto,
      from: replay.from,
      paths: replay.paths,
      taking: replay.taking,
      reloaded,
    };
  });
