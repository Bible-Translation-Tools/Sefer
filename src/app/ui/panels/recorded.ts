/**
 * The last RECORDED version of each book, which is the only baseline a review
 * screen may use.
 *
 * Why this exists at all: `SaveCoordinator.baseline` is the last write to
 * DISK, and the disk is not the history. Recording writes and commits in one
 * action, so the two usually agree — but a write whose commit failed leaves
 * bytes on disk that no version holds, and a review built on the disk baseline
 * would report that work as nothing at all. "What has changed" on a Save or
 * History screen means "since the last version", so the baseline is the blob
 * at HEAD.
 *
 * The blobs are read once per HEAD and cached against that commit id: `tick()`
 * moves on every keystroke and the recorded version does not move at all until
 * somebody commits. `refresh()` is what a commit (and the Reload button) calls.
 *
 * A project with no repository, or a book HEAD has never seen, is not an
 * error: it is a book that will be recorded for the FIRST time, and the panels
 * say exactly that rather than inventing an empty baseline to diff against.
 */

import { Effect, Option, Result } from "effect";
import { createEffect, createSignal, type Accessor } from "solid-js";

import type { BookId } from "#core/book/book";
import { Git, repositoryPath } from "#core/git/git";
import type { Project } from "#core/project/project";
import { decode, type Source } from "#core/source/source";
import { trackingRef } from "#core/sync";

import type { Shell } from "../../ProjectContext";

export interface Recorded {
  /** The commit the texts came from; absent when nothing is recorded yet. */
  readonly head: string | undefined;
  /** Book → its text in that commit. A missing book has never been recorded. */
  readonly texts: ReadonlyMap<BookId, Source>;
  /** False until the first read comes back, so a panel can wait to judge. */
  readonly read: boolean;
}

const NOTHING: Recorded = { head: undefined, texts: new Map(), read: true };

export interface RecordedVersion {
  readonly recorded: Accessor<Recorded>;
  /** Re-read HEAD. Call it after a commit, and from a Reload button. */
  readonly refresh: () => void;
}

/**
 * Reads HEAD's blobs for every book in the open project.
 *
 * One pass, on creation and on `refresh()`. Every git call goes through
 * `Effect.result`: a project with no repository is the ordinary case in a
 * browser fixture and must not raise.
 */
/**
 * Which commit a reader stands on: `head`, the last version recorded here;
 * `shared`, the shared project's newest version as the last check fetched it
 * (the branch's remote-tracking ref); or `base`, the newest version the two
 * have in common — what "who changed this" is measured from. All three are
 * frozen commits; only which one is read differs.
 */
export type RecordedRef = "head" | "shared" | "base";

export const createRecordedVersion = (
  shell: Shell,
  ref: RecordedRef = "head",
  /** The ref "shared" means when it is not the branch's tracking ref: a suggestion's head. */
  theirs?: () => string | undefined,
): RecordedVersion => {
  const [recorded, setRecorded] = createSignal<Recorded>(
    { head: undefined, texts: new Map(), read: false },
    { name: "recordedVersion" },
  );

  /**
   * One pass. The project is a PARAMETER, not a read: this runs from an effect
   * callback, where Solid 2 rightly warns that a read will not track, and the
   * caller is the one that knows which project it means. Every write to the
   * signal is asynchronous, through `run`, because Solid 2 refuses a
   * synchronous write from a component body.
   */
  const load = (project: Project | undefined): void => {
    if (project === undefined) {
      void Promise.resolve().then(() => setRecorded(NOTHING));
      return;
    }
    void shell.services
      .run(
        Effect.gen(function* () {
          const git = yield* Git;
          const opened = yield* Effect.result(git.open(project.root));
          if (Result.isFailure(opened)) return NOTHING;
          const repo = opened.success;
          let head: string | undefined;
          if (ref === "head") {
            const log = yield* Effect.result(git.log(repo));
            head = Result.isSuccess(log) ? log.success[0]?.id : undefined;
          } else {
            const branch = yield* Effect.orElseSucceed(git.branch(repo), () =>
              Option.none<string>(),
            );
            const tip = Option.isNone(branch)
              ? Option.none<string>()
              : yield* Effect.orElseSucceed(
                  git.resolve(repo, theirs?.() ?? trackingRef(branch.value)),
                  () => Option.none<string>(),
                );
            head = Option.getOrUndefined(tip);
            if (ref === "base" && head !== undefined) {
              const theirs = head;
              const mine = yield* Effect.orElseSucceed(git.resolve(repo, "HEAD"), () =>
                Option.none<string>(),
              );
              head = Option.isNone(mine)
                ? undefined
                : Option.getOrUndefined(
                    yield* Effect.orElseSucceed(git.mergeBase(repo, mine.value, theirs), () =>
                      Option.none<string>(),
                    ),
                  );
            }
          }
          if (head === undefined) return NOTHING;
          const texts = new Map<BookId, Source>();
          for (const book of project.books) {
            const inside = repositoryPath(project.root, book.path);
            if (Option.isNone(inside)) continue;
            // A book absent from HEAD fails `show`, which is the answer, not a
            // problem: it has never been recorded.
            const bytes = yield* Effect.result(git.show(repo, head, inside.value));
            if (Result.isFailure(bytes)) continue;
            const source = decode(bytes.success);
            if (Result.isSuccess(source)) texts.set(book.id, source.success);
          }
          return { head, texts, read: true } satisfies Recorded;
        }),
      )
      .then(setRecorded);
  };

  // On mount, and again whenever a different project is opened underneath us.
  createEffect(
    () => shell.project(),
    (project) => {
      load(project);
    },
  );

  return { recorded, refresh: () => load(shell.project()) };
};
