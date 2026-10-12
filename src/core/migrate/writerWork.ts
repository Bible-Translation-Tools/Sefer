/**
 * "Is someone still working in Writer?": the check of a project's Writer
 * upstreams, and what new work there looks like as a text to review.
 *
 * A project that came from Writer follows each book's Writer project
 * (`.upstreams.json`, committed). While it does, the check is part of the
 * ordinary sync lifecycle, AFTER the shared project's (Will, 2026-10-02: the
 * Shared project first, the two never in one pass), so a teammate who already
 * took the work and sent it is what the project is compared against.
 *
 * 1. `probeUpstreams` asks each remote for its head, a few at a time. One
 *    whose head is the commit the project took — here, or on the shared
 *    project's side — has nothing new.
 * 2. `fetchWork` clones a moved one into staging, with history (a Writer
 *    project is 50–100 KB), and renders two texts through the one template:
 *    `theirs` at its head, and `base` at the commit the project took. Saves
 *    that changed no chunk or title (Writer autosaves its manifest) are not
 *    new work.
 * 3. `incoming` turns the three texts into the other side of a review: this
 *    project's book, with THEIR text only in the verses they changed since
 *    the base. Every other verse is ours, so a review shows their changes
 *    and nothing of our own edits; a verse both changed shows as a
 *    difference to decide. Text is never merged automatically: the review
 *    decides every unit.
 */

import { Effect, FileSystem, Option, Result } from "effect";

import type { Addr, GalleyService, MergeSide } from "../galley";
import { Git } from "../git/git";
import { Remote } from "../remote/remote";
import { normaliseRepoUrl } from "../resources/relationships";
import { decode } from "../source/source";
import { readUpstreams, UPSTREAMS_FILE, upstreamsText, type Upstream } from "./upstreams";
import {
  isWriterTextPath,
  readWriterTree,
  recognizeWriter,
  treeFromFiles,
  writerBookToUsfm,
} from "./writerBook";

/** The upstreams a project follows, from its working tree. None when the file is absent or unreadable. */
export const projectUpstreams = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<readonly Upstream[]> =>
  Effect.map(
    Effect.orElseSucceed(fileSystem.readFileString(`${root}/${UPSTREAMS_FILE}`), () => ""),
    (text) => (text === "" ? [] : Option.getOrElse(readUpstreams(text), () => [])),
  );

export interface Probed {
  readonly upstream: Upstream;
  /** The remote's head; `undefined` when it did not answer. */
  readonly head: string | undefined;
}

/**
 * How long one remote gets to answer a probe, or one Writer project to clone.
 * A remote that takes longer counts as one that did not answer: no work this
 * time, and the other books' work is not held up behind it.
 */
export const UPSTREAM_TIMEOUT = "15 seconds";

/** Each upstream's head, a few at a time. A remote that does not answer has no head, and no work. */
export const probeUpstreams = (
  upstreams: readonly Upstream[],
): Effect.Effect<readonly Probed[], never, Remote> =>
  Effect.gen(function* () {
    const remote = yield* Remote;
    return yield* Effect.forEach(
      upstreams,
      (upstream) =>
        Effect.map(
          Effect.orElseSucceed(
            Effect.timeout(remote.probe(upstream.url), UPSTREAM_TIMEOUT),
            () => undefined,
          ),
          (probe): Probed => ({
            upstream,
            head: probe === undefined ? undefined : Option.getOrUndefined(probe.head),
          }),
        ),
      { concurrency: 6 },
    );
  });

/** New work in one Writer project, ready to review. */
export interface WriterWork {
  readonly upstream: Upstream;
  readonly book: string;
  /** The Writer project's owner, as the screen names it: `mary_chishimba`. */
  readonly owner: string;
  readonly head: string;
  /** Who saved last, and when (ms). */
  readonly latest: { readonly name: string; readonly at: number };
  /** The text at the commit the project took; `undefined` when that commit is gone (force-pushed). */
  readonly base: string | undefined;
  /** The text at their head. */
  readonly theirs: string;
}

const ownerOf = (url: string): string => normaliseRepoUrl(url).split("/").at(-2) ?? "";

const text = (bytes: Uint8Array): string | undefined => {
  const decoded = decode(bytes);
  return Result.isSuccess(decoded) ? decoded.success.text : undefined;
};

/**
 * Fetches one moved Writer project and renders it at its head and at the
 * commit the project took. `undefined` when the saves since changed no text
 * the template reads, or the folder is no longer a Writer project of that
 * book.
 */
export const fetchWork = (
  probed: Probed & { readonly head: string },
  stagingRoot: string,
): Effect.Effect<WriterWork | undefined, unknown, FileSystem.FileSystem | Git | Remote> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const remote = yield* Remote;
    const { upstream, head } = probed;
    const book = upstream.books[0];
    if (book === undefined) return undefined;
    const root = `${stagingRoot}/${normaliseRepoUrl(upstream.url).split("/").slice(-2).join("_")}`;
    yield* Effect.ignore(fileSystem.remove(root, { recursive: true }));
    const { repo } = yield* remote.clone(upstream.url, root, { history: "all" });
    const project = yield* recognizeWriter(fileSystem, root);
    if (project?.book !== book) return undefined;

    // What their saves since our commit touched. A commit that is gone
    // (rewritten history) leaves no base: the review is then two-way.
    const changed = yield* Effect.option(git.changedPathsBetween(repo, upstream.commit, head));
    if (Option.isSome(changed) && !changed.value.some((entry) => isWriterTextPath(entry.path)))
      return undefined;

    const theirsTree = yield* readWriterTree(fileSystem, root);
    const theirs = writerBookToUsfm(theirsTree, book, book);

    let base: string | undefined;
    if (Option.isSome(changed)) {
      // Our commit's files: today's, with each changed one read at that
      // commit instead (or left out, when it did not exist then).
      const files = new Map<string, string>();
      const now = yield* readWriterFiles(fileSystem, root);
      for (const [path, value] of now) files.set(path, value);
      for (const entry of changed.value) {
        if (!isWriterTextPath(entry.path)) continue;
        const then = yield* Effect.option(git.show(repo, upstream.commit, entry.path));
        const decoded = Option.isSome(then) ? text(then.value) : undefined;
        if (decoded === undefined) files.delete(entry.path);
        else files.set(entry.path, decoded);
      }
      base = writerBookToUsfm(treeFromFiles(files), book, book);
    }

    const log = yield* Effect.orElseSucceed(git.log(repo), () => []);
    const newest = log[0];
    return {
      upstream,
      book,
      owner: ownerOf(upstream.url),
      head,
      latest: { name: newest?.author.name ?? ownerOf(upstream.url), at: newest?.at ?? Date.now() },
      base,
      theirs,
    };
  });

/** The template's files off disk, by relative path. */
const readWriterFiles = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<ReadonlyMap<string, string>> =>
  Effect.gen(function* () {
    const out = new Map<string, string>();
    const entries = yield* Effect.orElseSucceed(
      fileSystem.readDirectory(root, { recursive: true }),
      (): readonly string[] => [],
    );
    for (const path of entries.filter(isWriterTextPath)) {
      const bytes = yield* Effect.option(fileSystem.readFile(`${root}/${path}`));
      const decoded = Option.isSome(bytes) ? text(bytes.value) : undefined;
      if (decoded !== undefined) out.set(path, decoded);
    }
    return out;
  });

/** A block's place, the same in any two texts of one book: chapter, verses, occurrence. */
const placeOf = (addr: Addr | undefined): string | undefined =>
  addr === undefined
    ? undefined
    : `${String(addr.chapter)}:${String(addr.first)}-${String(addr.last)}:${String(addr.cdup)}:${String(addr.vdup)}:${addr.kind}`;

/**
 * The other side of a review of their work: `ours`, with `theirs` only where
 * they changed something since `base`. With no base, all of `theirs`.
 * `undefined` when the engine's diff door is missing.
 */
export const incoming = (
  galley: GalleyService,
  work: WriterWork,
  ours: string,
): string | undefined => {
  if (work.base === undefined) return work.theirs;
  const theirChanges = galley.diff(work.base, work.theirs);
  if (Result.isFailure(theirChanges)) return undefined;
  const touched = new Set<string>();
  for (const unit of theirChanges.success.units) {
    if (unit.status === "unchanged") continue;
    for (const place of [placeOf(unit.baselineAddr), placeOf(unit.currentAddr)])
      if (place !== undefined) touched.add(place);
  }
  // Theirs as the baseline, ours as current: take theirs in exactly the
  // places they touched, ours everywhere else.
  const against = galley.diff(work.theirs, ours);
  if (Result.isFailure(against)) return undefined;
  const decisions = new Map<string, MergeSide>();
  for (const unit of against.success.units) {
    if (unit.status === "unchanged") continue;
    const theirsTouched = [placeOf(unit.baselineAddr), placeOf(unit.currentAddr)].some(
      (place) => place !== undefined && touched.has(place),
    );
    decisions.set(unit.id, theirsTouched ? "baseline" : "current");
  }
  const merged = galley.merge(work.theirs, ours, decisions, "current");
  return Result.isSuccess(merged) ? merged.success : undefined;
};

/** `.upstreams.json` with the given books' work taken at the given heads. */
export const takenText = (
  upstreams: readonly Upstream[],
  taken: ReadonlyMap<string, string>,
  date: string,
): string =>
  upstreamsText(
    upstreams.map((upstream) => {
      const head = upstream.books.map((book) => taken.get(book)).find((each) => each !== undefined);
      return head === undefined ? upstream : { ...upstream, commit: head, takenAt: date };
    }),
  );
