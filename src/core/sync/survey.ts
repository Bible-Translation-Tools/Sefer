/**
 * The IO half of the incoming plan: the blobs a three-way question needs,
 * read through the ports and handed to the pure `incomingPlan`.
 *
 * It lives in core rather than in the shell because TWO callers now need the
 * same answer and they must not be able to disagree about it. `/cloud`'s
 * reading (`src/app/ui/cloud/reading.ts`) asks what would arrive; `./combine`
 * asks whether a combine is safe to run at all. If those two computed
 * "contested" separately, the screen could offer a combine the program then
 * refuses — or worse, the other way round.
 *
 * Nothing here decides anything. It reads three revisions of every file the
 * cloud touched, asks the engine where each one's chapters are, and
 * `./plan.ts` does the arithmetic.
 */

import { Effect, FileSystem } from "effect";

import { identifyBook } from "../book/book";
import { Galley, toLf, tocViewOf } from "../galley";
import { Git, type ChangedPath, type Commit, type Repo } from "../git/git";
import { incomingPlan, type ChapterRows, type IncomingFile, type IncomingPlan } from "./plan";

/** Only scripture files get a plan; a manifest change is not a chapter. */
const USFM = /\.usfm$/iu;

/**
 * The newest commit both sides hold — the merge base, near enough.
 *
 * "Near enough" is honest: this walks the two logs rather than asking libgit2
 * for a true merge base, so a repository with criss-cross merges could answer
 * with an ancestor of the real base. The cost of that is a plan that lists
 * MORE changed chapters than strictly necessary, which is the safe direction
 * to be wrong in. `undefined` means no shared history at all — and that is a
 * refusal for Combine rather than something to replay over.
 */
export const mergeBase = (
  local: readonly Commit[],
  remote: readonly Commit[],
): Commit | undefined => {
  const theirs = new Set(remote.map((commit) => commit.id));
  return local.find((commit) => theirs.has(commit.id));
};

export interface SurveyOptions {
  /** The remote-tracking ref the cloud's side is read from. */
  readonly tracking: string;
  /** The last version both sides shared; `undefined` when there is none. */
  readonly base: Commit | undefined;
  /** The cloud's commits this device does not have, newest first. */
  readonly behind: readonly Commit[];
}

/** What one survey answers: the plan, and the raw paths it was built from. */
export interface IncomingSurvey {
  readonly plan: IncomingPlan;
  /** Every path the cloud changed since the base, scripture or not. */
  readonly changed: readonly ChangedPath[];
}

/** An effect whose failure is an answer rather than a fault. */
const orEmpty = <A, E>(effect: Effect.Effect<A, E>, fallback: A): Effect.Effect<A> =>
  Effect.orElseSucceed(effect, () => fallback);

/**
 * A blob as LF text, or `""` when the path did not exist at that revision.
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
      (bytes) => toLf(new TextDecoder().decode(bytes)).text,
    ),
    () => "",
  );

/** The work tree's own copy, which may hold edits no version has recorded. LF. */
const textHere = (
  fileSystem: FileSystem.FileSystem,
  root: string,
  path: string,
): Effect.Effect<string> =>
  orEmpty(
    Effect.map(fileSystem.readFileString(`${root}/${path}`), (text) => toLf(text).text),
    "",
  );

/**
 * What a pull would change, read out of the object database.
 *
 * Costs no network: everything below is already down from the last fetch.
 * Every read degrades to `""` rather than failing — an unreadable blob then
 * looks changed on both sides, which is the pessimistic answer and the safe
 * one, because it sends the book to Compare instead of into a replay.
 */
export const surveyIncoming = (
  repo: Repo,
  options: SurveyOptions,
): Effect.Effect<IncomingSurvey, never, Git | FileSystem.FileSystem | Galley> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const fileSystem = yield* FileSystem.FileSystem;
    const galley = yield* Galley;
    // The loose-text door: these blobs are not books the corpus holds.
    const rows: ChapterRows = (text) => tocViewOf(galley.analyze(text, "sync.plan")).chapters;
    const from = options.base?.id ?? options.tracking;
    // SAFETY: the fallback is the empty list, which inhabits `readonly
    // ChangedPath[]`; the annotation only stops TypeScript inferring `never[]`
    // and then rejecting the real answer.
    const empty = [] as readonly ChangedPath[];
    const changed = yield* orEmpty(git.changedPathsBetween(repo, from, options.tracking), empty);

    const files: IncomingFile[] = [];
    for (const entry of changed) {
      if (!USFM.test(entry.path)) continue;
      const cloud = yield* textAt(repo, options.tracking, entry.path);
      const here = yield* textHere(fileSystem, repo.root, entry.path);
      // With no shared history there is no base to measure from, and `""` is
      // the safe reading: every chapter counts as changed on both sides, so
      // nothing is offered as an automatic fast-forward.
      const base =
        options.base === undefined ? "" : yield* textAt(repo, options.base.id, entry.path);
      files.push({
        path: entry.path,
        bookId: identifyBook(cloud === "" ? here : cloud, entry.path),
        kind: entry.kind,
        base,
        cloud,
        here,
      });
    }

    return { plan: incomingPlan(options.behind, files, rows), changed };
  });
