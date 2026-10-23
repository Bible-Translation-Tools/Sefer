import type { BookId } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";
import { Data, Effect, FileSystem, Option, type PlatformError, Result } from "effect";

import { ProjectAdmin } from "../admin/projectAdmin";
import { parentPath } from "../fileSystem/path";
import type { Galley } from "../galley";
import {
  type Author,
  type ChangedPath,
  type CommitId,
  Git,
  type GitError,
  repositoryPath,
  type Repo,
  type SaveReceiptLike,
} from "../git/git";
import { Repositories } from "../git/repository";
import { METADATA_FILE } from "../project/discovery";
import type { Project } from "../project/project";
import { Remote, type RemoteError } from "../remote/remote";
import { SaveCoordinator } from "../save/saveCoordinator";
import {
  booksByPath,
  classify,
  giveBack,
  handOver,
  isScripture,
  type Applied,
  type Classified,
} from "./classify";
import { DEFAULT_OVERLAP, judge, type Overlap } from "./policy";
import { notIn, trackingRef } from "./state";

export type CombineRefusal =
  | "no-branch"
  | "no-work-here"
  | "no-cloud-copy"
  | "no-shared-version"
  | "not-diverged"
  | "contested"
  | "deletion"
  | "moved";

export type CombineState = "untouched" | "restored" | "recorded" | "stranded";

class CombineError extends Data.TaggedError("CombineError")<{
  readonly refusal: CombineRefusal | undefined;
  readonly state: CombineState;
  readonly description: string;
}> {}

interface CombineSurvey {
  readonly branch: string | undefined;
  readonly localHead: CommitId | undefined;
  readonly cloudHead: CommitId | undefined;
  readonly base: CommitId | undefined;
  readonly ahead: number;
  readonly behind: number;
  readonly changed: readonly ChangedPath[];
  readonly cloudChanged: readonly ChangedPath[];
  readonly unrecorded: readonly string[];
  readonly review: readonly string[];
}

interface CombineReplay {
  readonly branch: string;
  readonly from: CommitId;
  readonly onto: CommitId;
  readonly paths: readonly string[];
  readonly taking: readonly string[];
  readonly message: string;
}

type CombineDecision =
  | { readonly ok: true; readonly replay: CombineReplay }
  | { readonly ok: false; readonly refusal: CombineRefusal; readonly detail: string };

const combineMessage = (books: number): string =>
  books === 1
    ? "Combined with the shared project: 1 book"
    : `Combined with the shared project: ${books} books`;

const no = (refusal: CombineRefusal, detail: string): CombineDecision => ({
  ok: false,
  refusal,
  detail,
});

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
  const mine = new Set([...survey.changed.map((entry) => entry.path), ...survey.unrecorded]);
  const both = survey.cloudChanged
    .filter(
      (entry) => !isScripture(entry.path) && entry.path !== METADATA_FILE && mine.has(entry.path),
    )
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

export interface CombineResult {
  readonly commit: CommitId;
  readonly onto: CommitId;
  readonly from: CommitId;
  readonly paths: readonly string[];
  readonly taking: readonly string[];
  readonly reloaded: readonly BookId[];
}

const dedupe = (repo: Repo, receipts: readonly SaveReceiptLike[]): readonly SaveReceiptLike[] => {
  const seen = new Set<string>();
  return receipts.filter((receipt) => {
    const key = Option.getOrElse(repositoryPath(repo.root, receipt.path), () => receipt.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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
  readonly project: Project;
  readonly author: Author;
  readonly overlap?: Overlap;
  readonly settled?: ReadonlySet<BookId>;
  readonly theirs?: string;
  readonly sendTo?: string;
  readonly message?: string;
}

interface Gathered {
  readonly decision: CombineDecision;
  readonly decided: readonly string[];
  readonly classified: Classified;
}

const gather = (
  repo: Repo,
  project: Project,
  overlap: Overlap,
  settled: ReadonlySet<BookId> = new Set(),
  theirs?: string,
): Effect.Effect<Gathered, CombineError, Git | FileSystem.FileSystem | Galley> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const untouched = fromPort("untouched");

    const branch = Option.getOrUndefined(yield* Effect.mapError(git.branch(repo), untouched));
    const tracking = branch === undefined ? undefined : (theirs ?? trackingRef(branch));
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
    const classified: Classified =
      base === undefined || cloudHead === undefined
        ? { facts: [], stamps: new Map<string, SourceStamp>(), theirs: new Map<string, string>() }
        : yield* classify(repo, books, base, cloudHead, cloudChanged);
    const verdicts = judge(classified.facts, overlap);
    const needsPerson = classified.facts.filter(
      (_, index) => verdicts[index] === "review" || verdicts[index] === "combine",
    );
    const decided = [...books].filter(([, book]) => settled.has(book.id)).map(([path]) => path);
    const review = needsPerson
      .filter((book) => !decided.includes(book.path))
      .map((book) => book.bookId);

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
        cloudChanged: cloudChanged.filter((entry) => !decided.includes(entry.path)),
        unrecorded: status.changed
          .map((entry) => entry.path)
          .filter((path) => !decided.includes(path)),
        review,
      }),
      classified,
    };
  });

export const combine = (
  options: CombineOptions,
): Effect.Effect<
  CombineResult,
  CombineError,
  Git | Remote | Repositories | SaveCoordinator | FileSystem.FileSystem | Galley
> =>
  Effect.gen(function* () {
    const repositories = yield* Repositories;
    const git = yield* Git;
    const remote = yield* Remote;
    const repo = yield* Effect.mapError(git.open(options.project.root), fromPort("untouched"));
    yield* Effect.mapError(remote.fetch(repo), fromPort("untouched"));
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

    const gathered = yield* gather(
      repo,
      project,
      options.overlap ?? DEFAULT_OVERLAP,
      options.settled,
      options.theirs,
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

    const handed = yield* handOver(
      repo,
      project,
      gathered.classified,
      replay.taking.filter(isScripture),
      "incoming",
    );
    if (!handed.ok)
      return yield* Effect.fail(
        new CombineError({
          refusal: "moved" in handed ? "moved" : undefined,
          state: "untouched",
          description:
            "moved" in handed
              ? `changed while combining: ${handed.moved.join(", ")}`
              : `${handed.refused} was refused by ${handed.rule}`,
        }),
      );
    const applied: readonly Applied[] = handed.applied;
    const untouchedAfterHandOver = (error: CombineError) =>
      Effect.flatMap(giveBack(applied), () => Effect.fail(error));

    const metadataHere = yield* Effect.orElseSucceed(
      fileSystem.exists(`${repo.root}/${METADATA_FILE}`),
      () => false,
    );
    const touched = [...new Set([...replay.taking, ...(metadataHere ? [METADATA_FILE] : [])])];
    const before: { readonly path: string; readonly bytes: Uint8Array | undefined }[] = [];
    for (const path of touched)
      before.push({
        path,
        bytes: yield* Effect.orElseSucceed(
          Effect.map(
            fileSystem.readFile(`${repo.root}/${path}`),
            (bytes): Uint8Array | undefined => bytes,
          ),
          () => undefined,
        ),
      });
    const arriving: { readonly path: string; readonly bytes: Uint8Array }[] = [];
    for (const path of replay.taking) {
      const bytes = yield* Effect.result(git.show(repo, replay.onto, path));
      if (Result.isFailure(bytes)) return yield* untouchedAfterHandOver(untouched(bytes.failure));
      arriving.push({ path, bytes: bytes.success });
    }

    const write = (path: string, bytes: Uint8Array) =>
      Effect.gen(function* () {
        const full = `${repo.root}/${path}`;
        yield* fileSystem.makeDirectory(parentPath(full), { recursive: true });
        yield* fileSystem.writeFile(full, bytes);
      });

    const books = booksByPath(repo, project);
    const decidedBooks = gathered.decided.flatMap((path) => {
      const book = books.get(path);
      return book === undefined || !save.dirty(book) ? [] : [book];
    });
    const saved = yield* Effect.result(save.saveAll(decidedBooks));
    if (Result.isFailure(saved))
      return yield* untouchedAfterHandOver(
        new CombineError({
          refusal: undefined,
          state: "untouched",
          description: saved.failure.description ?? saved.failure.reason,
        }),
      );

    const admin = Option.getOrUndefined(yield* Effect.serviceOption(ProjectAdmin));
    const recorded = yield* Effect.result(
      Effect.gen(function* () {
        for (const file of arriving)
          yield* Effect.mapError(write(file.path, file.bytes), fromDisk("restored"));
        if (metadataHere && admin !== undefined)
          yield* Effect.mapError(
            admin.refreshChecksums(repo.root),
            (error) =>
              new CombineError({
                refusal: undefined,
                state: "restored",
                description: error.description ?? error.reason,
              }),
          );
        const receipts: readonly SaveReceiptLike[] = [
          ...arriving.map((file) => ({
            path: file.path,
            stamp: { revision: 0, length: file.bytes.length },
          })),
          ...saved.success.flatMap((receipt) => [
            { path: receipt.path, stamp: receipt.stamp },
            ...receipt.also.map((path) => ({ path, stamp: receipt.stamp })),
          ]),
          ...(metadataHere ? [{ path: METADATA_FILE, stamp: { revision: 0, length: 0 } }] : []),
        ];
        return yield* Effect.mapError(
          git.commit(
            repo,
            dedupe(repo, receipts),
            options.message ?? replay.message,
            options.author,
            {
              alsoParents: [replay.onto],
            },
          ),
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
      yield* giveBack(applied);
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

    const reloaded: BookId[] = applied.map((entry) => entry.book.id);
    const now = booksByPath(repo, project);
    for (const path of replay.taking) {
      const book = now.get(path);
      if (book === undefined || !isScripture(path)) continue;
      yield* Effect.ignore(save.takeDisk(book, "incoming", "keep"));
    }

    yield* Effect.mapError(remote.push(repo, options.sendTo), fromPort("recorded"));
    return {
      commit: recorded.success,
      onto: replay.onto,
      from: replay.from,
      paths: replay.paths,
      taking: replay.taking,
      reloaded,
    };
  });
