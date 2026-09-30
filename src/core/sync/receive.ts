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
 * 4. refuse whole if any book needs a person;
 * 5. fast-forward: the branch moves and the work tree follows, safely (a file
 *    with unrecorded changes refuses the move before anything is written);
 * 6. hand each changed Book the text its file now holds, as one `incoming`
 *    edit, so the editor, Undo, the journal and Save all move with it.
 *
 * Step 6 is what a pull never did: it moved the files and left every open
 * Book, and its baseline, on the old text — so the next save wrote the old
 * text back over what had just arrived.
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
import { booksByPath, classify, isScripture, unmoved } from "./classify";
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
 */
export type ReceiveRefusal =
  | "no-branch"
  | "no-cloud-copy"
  | "no-shared-version"
  | "diverged"
  | "review";

export class ReceiveError extends Data.TaggedError("ReceiveError")<{
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
   * Books whose file moved forward but which were typed into while the
   * receive ran: their text stands, and Save & Review shows the difference.
   */
  readonly moved: readonly BookId[];
  /** Book files the other side added or removed; seen once the project reopens. */
  readonly reopen: readonly string[];
}

export interface ReceiveOptions {
  /** The open project: its Books are "mine", and the ones a receive reloads. */
  readonly project: Project;
  readonly overlap?: Overlap;
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
    const root = options.project.root;
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

    // 1. The other side as it is this second, not as the screen last saw it.
    yield* Effect.mapError(remote.fetch(repo), fromPort);
    const tip = Option.getOrUndefined(
      yield* Effect.mapError(git.resolve(repo, trackingRef(branch)), fromPort),
    );
    if (tip === undefined)
      return yield* Effect.fail(refuse("no-cloud-copy", `${trackingRef(branch)} does not exist`));
    const head = Option.getOrUndefined(yield* Effect.mapError(git.resolve(repo, "HEAD"), fromPort));
    const nothing: ReceiveResult = { head, paths: [], reloaded: [], moved: [], reopen: [] };
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
    const books = booksByPath(repo, project);

    // 3–4. Every changed book against the Book as it is now; typing may land
    // while the blobs are read, so a Book that moved is classified again.
    let classified = yield* classify(repo, books, head, tip, changed);
    if (!unmoved(classified, books)) classified = yield* classify(repo, books, head, tip, changed);
    const verdicts = judge(classified.facts, options.overlap ?? DEFAULT_OVERLAP);
    const review = classified.facts.filter((_, index) => verdicts[index] === "review");
    if (review.length > 0)
      return yield* Effect.fail(
        refuse(
          "review",
          `both sides changed ${review.map((book) => book.bookId).join(", ")}`,
          review.map((book) => book.bookId),
        ),
      );

    // 5. The files move forward, safely.
    yield* Effect.mapError(remote.fastForward(repo, tip), fromPort);

    // 6. And the Books with them. A Book typed into since it was classified
    // keeps its text; its baseline still moves, so Review shows the change.
    const reloaded: BookId[] = [];
    const moved: BookId[] = [];
    const reopen: string[] = [];
    for (const entry of changed) {
      if (!isScripture(entry.path)) continue;
      const book = books.get(entry.path);
      if (book === undefined || entry.kind !== "modified") {
        // The project's book set is fixed when it opens: an added or removed
        // book file is there on disk and appears at the next open.
        reopen.push(entry.path);
        continue;
      }
      const applied = yield* Effect.mapError(
        save.takeDisk(book, "incoming", classified.stamps.get(entry.path)),
        (error) => new ReceiveError({ refusal: undefined, description: error.description }),
      );
      (applied ? reloaded : moved).push(book.id);
    }
    observability?.note("sync.receive", "rewrote", undefined, {
      "sync.paths": changed.length,
      "sync.reloaded": reloaded.length,
      "sync.moved": moved.length,
      "sync.reopen": reopen.length,
    });
    return { head: tip, paths: changed.map((entry) => entry.path), reloaded, moved, reopen };
  });
