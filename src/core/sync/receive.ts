/**
 * Receive: bring the shared project's new commits into this project — only
 * forward, only what the policy lets through, and through the Books.
 *
 * A receive is a fast-forward. It never merges, never forces a checkout and
 * never writes a file behind a Book's back:
 *
 * 1. fetch, so the other side's tip is this second's;
 * 2. refuse unless HEAD is the merge base (this device has no commits the
 *    other side lacks — that is a divergence, and Combine's);
 * 3. classify every book the other side changed against each Book's CURRENT
 *    Source — unsaved edits included — and ask the policy;
 * 4. refuse whole if any book needs a person, or a file the other side
 *    changed has changes here no version holds;
 * 5. hand each changed Book the other side's text, as one `incoming` edit, all
 *    or none in one synchronous step — so the editor, Undo, the journal and
 *    Save all move with it, and no keystroke lands between check and write;
 * 6. fast-forward: the branch moves and the work tree follows, safely; if it
 *    cannot, the Books are given their text back;
 * 7. every changed Book's baseline follows its file.
 *
 * Step 5 is what a pull never did: it moved the files and left every open
 * Book, and its baseline, on the old text — so the next save wrote the old
 * text back over what had just arrived. It comes BEFORE the files move so that
 * a Book that cannot take the text stops the receive with nothing to undo.
 *
 * The whole program runs in the repository's exclusive lane.
 */
import { Data, Effect, type FileSystem, Option } from "effect";

import type { BookId } from "../book/book";
import type { Galley } from "../galley";
import { Git, type CommitId } from "../git/git";
import { Repositories } from "../git/repository";
import { Observability } from "../observability";
import type { Project } from "../project/project";
import { Remote } from "../remote/remote";
import { SaveCoordinator } from "../save/saveCoordinator";
import { booksByPath, classify, giveBack, handOver, isScripture, unmoved } from "./classify";
import { DEFAULT_OVERLAP, judge, type Overlap } from "./policy";
import { trackingRef } from "./state";

/**
 * Why a receive did not run. Every one is decided before anything is written.
 *
 * - `no-branch` — HEAD is detached; there is no branch to move forward.
 * - `no-cloud-copy` — the shared project has no copy of this branch.
 * - `no-shared-version` — the two histories have no commit in common.
 * - `diverged` — this device has commits the other side lacks: Combine.
 * - `review` — a book both sides changed, by the policy's measure: Compare.
 * - `unrecorded` — a file the other side changed has changes here no version
 *   holds; moving it forward would lose them.
 * - `moved` — a book the other side changed was typed into, or opened, while
 *   the receive read it, twice running. Nothing was written.
 */
export type ReceiveRefusal =
  | "no-branch"
  | "no-cloud-copy"
  | "no-shared-version"
  | "diverged"
  | "review"
  | "unrecorded"
  | "moved";

class ReceiveError extends Data.TaggedError("ReceiveError")<{
  /** Which rule said no, or `undefined` when a port failed instead. */
  readonly refusal: ReceiveRefusal | undefined;
  readonly description: string;
  /** For `review`, the books that need a person. */
  readonly books?: readonly string[] | undefined;
}> {}

export interface ReceiveResult {
  /** Where the branch now points. */
  readonly head: CommitId | undefined;
  /** Repository-relative paths the fast-forward changed. */
  readonly paths: readonly string[];
  /** Books handed their new text. */
  readonly reloaded: readonly BookId[];
  /**
   * Books whose baseline could not follow their file — it could not be read
   * back. Their text stands; Save & Review shows the difference.
   */
  readonly unsettled: readonly BookId[];
  /** Book files the other side added or removed; seen once the project reopens. */
  readonly reopen: readonly string[];
}

export interface ReceiveOptions {
  /** The open project: its Books are "mine", and the ones a receive reloads. */
  readonly project: Project;
  readonly overlap?: Overlap;
  /**
   * Books a person has just settled in Review against the other side: each
   * one's text in the project IS the decision. Its file moves forward and
   * its text stays, reading as unsaved against the new file, for the commit
   * that follows to record — whatever the policy would have said.
   */
  readonly settled?: ReadonlySet<BookId>;
  /**
   * The ref "theirs" is read from — the shared project's remote-tracking ref
   * unless named: a suggestion's head, fetched to a local ref, or the
   * person's own copy as another of their devices left it, is received the
   * same way.
   */
  readonly theirs?: string;
}

const refuse = (refusal: ReceiveRefusal, description: string, books?: readonly string[]) =>
  new ReceiveError({ refusal, description, books });

const fromPort = (error: {
  readonly reason: string;
  readonly description?: string | undefined;
}): ReceiveError =>
  new ReceiveError({
    refusal: undefined,
    description: `${error.reason}: ${error.description ?? "no detail"}`,
  });

export const receive = (
  options: ReceiveOptions,
): Effect.Effect<
  ReceiveResult,
  ReceiveError,
  Git | Remote | Repositories | SaveCoordinator | Galley | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const repositories = yield* Repositories;
    const git = yield* Git;
    const remote = yield* Remote;
    const root = options.project.root;
    // 1. The other side as it is this second, not as a surface last saw it —
    // fetched BEFORE the exclusive lane is taken, so a slow network holds the
    // lane only for its own transfer and never a Record a version behind it.
    // Fetching here rather than inside is as fresh: a push is fast-forward
    // only, so a head that moves in between is refused, never overwritten.
    const repo = yield* Effect.mapError(git.open(root), fromPort);
    yield* Effect.mapError(remote.fetch(repo), fromPort);
    return yield* Effect.catchTag(
      repositories.exclusive(root, "receive", program(options)),
      "RepositoryError",
      (error) =>
        Effect.fail(new ReceiveError({ refusal: undefined, description: error.description })),
    );
  });

const program = (options: ReceiveOptions) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const save = yield* SaveCoordinator;
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
    const project = options.project;

    const repo = yield* Effect.mapError(git.open(project.root), fromPort);
    const branch = Option.getOrUndefined(yield* Effect.mapError(git.branch(repo), fromPort));
    if (branch === undefined) return yield* Effect.fail(refuse("no-branch", "HEAD is detached"));

    const tip = Option.getOrUndefined(
      yield* Effect.mapError(git.resolve(repo, options.theirs ?? trackingRef(branch)), fromPort),
    );
    if (tip === undefined)
      return yield* Effect.fail(
        refuse("no-cloud-copy", `${options.theirs ?? trackingRef(branch)} does not exist`),
      );
    const head = Option.getOrUndefined(yield* Effect.mapError(git.resolve(repo, "HEAD"), fromPort));
    const nothing: ReceiveResult = { head, paths: [], reloaded: [], unsettled: [], reopen: [] };
    if (head === tip) return nothing;

    // An unborn HEAD has nothing to measure "mine" from, and a checkout over
    // it could land on files no commit holds.
    if (head === undefined)
      return yield* Effect.fail(refuse("no-shared-version", "this project has no commit yet"));

    // 2. Forward only.
    {
      const base = Option.getOrUndefined(
        yield* Effect.mapError(git.mergeBase(repo, head, tip), fromPort),
      );
      if (base === undefined)
        return yield* Effect.fail(
          refuse("no-shared-version", "the two histories have no commit in common"),
        );
      if (base === tip) return nothing;
      if (base !== head)
        return yield* Effect.fail(
          refuse("diverged", "this device has commits the shared project does not"),
        );
    }

    const changed = yield* Effect.mapError(git.changedPathsBetween(repo, head, tip), fromPort);

    // 3–4. Every changed book against the Book as it is now, and the policy.
    const settled = options.settled ?? new Set<BookId>();
    const decide = Effect.gen(function* () {
      const books = booksByPath(repo, project);
      let classified = yield* classify(repo, books, head, tip, changed);
      if (!unmoved(classified, books))
        classified = yield* classify(repo, books, head, tip, changed);
      const verdicts = judge(classified.facts, options.overlap ?? DEFAULT_OVERLAP);
      const isSettled = (path: string): boolean => {
        const book = books.get(path);
        return book !== undefined && settled.has(book.id);
      };
      // `combine` below the book scope would need a unit-level merge, which a
      // receive does not do: it goes to a person like `review`.
      const review = classified.facts.filter(
        (book, index) =>
          (verdicts[index] === "review" || verdicts[index] === "combine") && !isSettled(book.path),
      );
      const taking = changed
        .filter((entry) => isScripture(entry.path) && entry.kind === "modified")
        .map((entry) => entry.path)
        .filter((path) => !isSettled(path));
      return { classified, review, taking };
    });

    let decided = yield* decide;
    if (decided.review.length > 0)
      return yield* Effect.fail(
        refuse(
          "review",
          `both sides changed ${decided.review.map((book) => book.bookId).join(", ")}`,
          decided.review.map((book) => book.bookId),
        ),
      );

    // A file with changes here that no version holds would stop the checkout
    // part-way, after the Books had moved; so it refuses before anything does.
    const status = yield* Effect.mapError(git.status(repo), fromPort);
    const theirs = new Set(changed.map((entry) => entry.path));
    const unrecorded = status.changed.map((entry) => entry.path).filter((path) => theirs.has(path));
    if (unrecorded.length > 0)
      return yield* Effect.fail(
        refuse("unrecorded", `changes here no version holds: ${unrecorded.join(", ")}`),
      );

    // 5. The Books take the other side's text first, all or none, in one step
    // no keystroke can interrupt. A Book that moved since it was read is read
    // again, once.
    let handed = yield* handOver(repo, project, decided.classified, decided.taking, "incoming");
    if (!handed.ok && "moved" in handed) {
      decided = yield* decide;
      if (decided.review.length > 0)
        return yield* Effect.fail(
          refuse(
            "review",
            `both sides changed ${decided.review.map((book) => book.bookId).join(", ")}`,
            decided.review.map((book) => book.bookId),
          ),
        );
      handed = yield* handOver(repo, project, decided.classified, decided.taking, "incoming");
    }
    if (!handed.ok)
      return yield* Effect.fail(
        "moved" in handed
          ? refuse("moved", `changed while receiving: ${handed.moved.join(", ")}`)
          : new ReceiveError({
              refusal: undefined,
              description: `${handed.refused} was refused by ${handed.rule}`,
            }),
      );
    const applied = handed.applied;

    // 6. The files move forward, safely. If they cannot, the Books go back.
    const moved = yield* Effect.result(remote.fastForward(repo, tip));
    if (moved._tag === "Failure") {
      yield* giveBack(applied);
      return yield* Effect.fail(fromPort(moved.failure));
    }

    // 7. The baselines follow the files, every one — a failure is listed,
    // not a reason to leave the rest behind.
    const reloaded: BookId[] = applied.map((entry) => entry.book.id);
    const unsettled: BookId[] = [];
    const reopen: string[] = [];
    const now = booksByPath(repo, project);
    for (const entry of changed) {
      if (!isScripture(entry.path)) continue;
      const book = now.get(entry.path);
      if (book === undefined || entry.kind !== "modified") {
        // The project's book set is fixed when it opens: an added or removed
        // book file is there on disk and appears at the next open.
        reopen.push(entry.path);
        continue;
      }
      const followed = yield* Effect.result(save.takeDisk(book, "incoming", "keep"));
      if (followed._tag === "Failure") unsettled.push(book.id);
    }
    observability?.note("sync.receive", "rewrote", undefined, {
      "sync.paths": changed.length,
      "sync.reloaded": reloaded.length,
      "sync.unsettled": unsettled.length,
      "sync.reopen": reopen.length,
    });
    return { head: tip, paths: changed.map((entry) => entry.path), reloaded, unsettled, reopen };
  });
