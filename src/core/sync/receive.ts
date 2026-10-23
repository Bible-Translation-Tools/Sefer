import type { BookId } from "@sefer/text/book";
import { Data, Effect, type FileSystem, Option } from "effect";

import type { Galley } from "../galley";
import { Git, type CommitId } from "../git/git";
import { Repositories } from "../git/repository";
import { Observability } from "../observability";
import type { Project } from "../project/project";
import { Remote } from "../remote/remote";
import { SaveCoordinator } from "../save/saveCoordinator";
import { booksByPath, classify, giveBack, handOver, isScripture, unmoved } from "./classify";
import type { BookFacts } from "./facts";
import { DEFAULT_OVERLAP, judge, type Overlap } from "./policy";
import { trackingRef } from "./state";

export type ReceiveRefusal =
  | "no-branch"
  | "no-cloud-copy"
  | "no-shared-version"
  | "diverged"
  | "review"
  | "unrecorded"
  | "moved";

class ReceiveError extends Data.TaggedError("ReceiveError")<{
  readonly refusal: ReceiveRefusal | undefined;
  readonly description: string;
  readonly books?: readonly string[] | undefined;
}> {}

export interface ReceiveResult {
  readonly head: CommitId | undefined;
  readonly paths: readonly string[];
  readonly reloaded: readonly BookId[];
  readonly unsettled: readonly BookId[];
  readonly reopen: readonly string[];
}

export interface ReceiveOptions {
  readonly project: Project;
  readonly overlap?: Overlap;
  readonly settled?: ReadonlySet<BookId>;
  readonly theirs?: string;
}

const refuse = (refusal: ReceiveRefusal, description: string, books?: readonly string[]) =>
  new ReceiveError({ refusal, description, books });

const reviewRefusal = (review: readonly BookFacts[]) =>
  refuse(
    "review",
    `both sides changed ${review.map((book) => book.bookId).join(", ")}`,
    review.map((book) => book.bookId),
  );

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

    if (head === undefined)
      return yield* Effect.fail(refuse("no-shared-version", "this project has no commit yet"));

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
    if (decided.review.length > 0) return yield* Effect.fail(reviewRefusal(decided.review));

    const status = yield* Effect.mapError(git.status(repo), fromPort);
    const theirs = new Set(changed.map((entry) => entry.path));
    const unrecorded = status.changed.map((entry) => entry.path).filter((path) => theirs.has(path));
    if (unrecorded.length > 0)
      return yield* Effect.fail(
        refuse("unrecorded", `changes here no version holds: ${unrecorded.join(", ")}`),
      );

    let handed = yield* handOver(repo, project, decided.classified, decided.taking, "incoming");
    if (!handed.ok && "moved" in handed) {
      decided = yield* decide;
      if (decided.review.length > 0) return yield* Effect.fail(reviewRefusal(decided.review));
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

    const moved = yield* Effect.result(remote.fastForward(repo, tip));
    if (moved._tag === "Failure") {
      yield* giveBack(applied);
      return yield* Effect.fail(fromPort(moved.failure));
    }

    const reloaded: BookId[] = applied.map((entry) => entry.book.id);
    const unsettled: BookId[] = [];
    const reopen: string[] = [];
    const now = booksByPath(repo, project);
    for (const entry of changed) {
      if (!isScripture(entry.path)) continue;
      const book = now.get(entry.path);
      if (book === undefined || entry.kind !== "modified") {
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
