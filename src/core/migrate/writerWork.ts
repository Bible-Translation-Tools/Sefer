// The check runs AFTER the shared project's (Will, 2026-10-02: the Shared project first, the two never in one pass).

import { decode } from "@sefer/text/source";
import { Effect, FileSystem, Option, Result } from "effect";

import type { Addr, GalleyService, MergeSide } from "../galley";
import { Git } from "../git/git";
import { Remote } from "../remote/remote";
import { normaliseRepoUrl } from "../resources/relationships";
import { readUpstreams, UPSTREAMS_FILE, upstreamsText, type Upstream } from "./upstreams";
import {
  isWriterTextPath,
  readWriterTree,
  recognizeWriter,
  treeFromFiles,
  writerBookToUsfm,
} from "./writerBook";

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
  readonly head: string | undefined;
}

export const UPSTREAM_TIMEOUT = "15 seconds";

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

export interface WriterWork {
  readonly upstream: Upstream;
  readonly book: string;
  readonly owner: string;
  readonly head: string;
  readonly latest: { readonly name: string; readonly at: number };
  readonly base: string | undefined;
  readonly theirs: string;
}

const ownerOf = (url: string): string => normaliseRepoUrl(url).split("/").at(-2) ?? "";

const text = (bytes: Uint8Array): string | undefined => {
  const decoded = decode(bytes);
  return Result.isSuccess(decoded) ? decoded.success.text : undefined;
};

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

    const changed = yield* Effect.option(git.changedPathsBetween(repo, upstream.commit, head));
    if (Option.isSome(changed) && !changed.value.some((entry) => isWriterTextPath(entry.path)))
      return undefined;

    const theirsTree = yield* readWriterTree(fileSystem, root);
    const theirs = writerBookToUsfm(theirsTree, book, book);

    let base: string | undefined;
    if (Option.isSome(changed)) {
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

const placeOf = (addr: Addr | undefined): string | undefined =>
  addr === undefined
    ? undefined
    : `${String(addr.chapter)}:${String(addr.first)}-${String(addr.last)}:${String(addr.cdup)}:${String(addr.vdup)}:${addr.kind}`;

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
