/**
 * The last RECORDED version of each book, which is the only baseline a review
 * screen may use.
 *
 * Why this exists at all: `SaveCoordinator.baseline` is the last write to
 * DISK, and the shell arms `autosave` per book, so about a second after typing
 * stops the disk baseline has already caught up with the editor. A review
 * built on it therefore shows an empty diff for a session full of work — the
 * bytes are safe, and nothing has been recorded. "What has changed" on a Save
 * or History screen means "since the last version", so the baseline has to be
 * the blob at HEAD.
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

import type { BookId } from "../../../core/book/book";
import { Git, repositoryPath } from "../../../core/git/git";
import type { Project } from "../../../core/project/project";
import { decode, type Source } from "../../../core/source/source";
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
export const createRecordedVersion = (shell: Shell): RecordedVersion => {
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
          const log = yield* Effect.result(git.log(repo));
          const head = Result.isSuccess(log) ? log.success[0]?.id : undefined;
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
