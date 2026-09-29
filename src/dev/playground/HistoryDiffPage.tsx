/** Dev-only, read-only history multibuffer for a separately selected project. */
import { getRouteApi, useNavigate } from "@tanstack/solid-router";
import { Effect, Option, Result } from "effect";
import { For, Show, createEffect, createMemo, createSignal, flush, untrack } from "solid-js";

import { describe } from "#app/describe";
import { useShell } from "#app/ProjectContext";
import { Badge, Card, Select } from "#app/ui/primitives";
import { ReviewReader, type ReviewBook } from "#app/ui/review/ReviewReader";
import { ShellGate } from "#app/ui/ShellGate";
import { nodeFsView } from "#core/fileSystem/nodeView";
import { joinPath, lastSegment } from "#core/fileSystem/path";
import { unitReference, type DecisionUnit } from "#core/galley/diff";
import { repositoryPath, type Repo } from "#core/git/git";
import { deriveDeltaScope, type ChapterChangeScope } from "#core/history/delta";
import { BoundedLru } from "#core/history/window";

import { pathHistory, readBlobById, type PathCommit, type PathHistoryEnd } from "./bookHistory";
import type { Bench } from "./experiment";
import {
  blobAt,
  bookHistoryFrom,
  booksChangedBetween,
  booksOf,
  commitsById,
  mergeBase,
  type BookChange,
  type BookIndex,
  type IndexedCommit,
} from "./history/bookIndex";
import { ensureIndex } from "./history/indexStore";
import { packView, type PackView } from "./history/packView";
import { inOrder } from "./units";

/** Decoded book texts by blob id; neighbouring slides share one string. */
const TEXT_CACHE_LIMIT = 8;
const TEXT_CACHE_CODE_UNIT_LIMIT = 4 * 1024 * 1024;
/** Slides that keep their comparison; the rest show only their header. */
const FRAME_LIMIT = 8;
/** Book changes read from the walk each time the left edge comes near. */
const PULL_BATCH = 8;

interface LocalProject {
  readonly root: string;
  readonly name: string;
}

interface LocalBook {
  readonly path: string;
  readonly label: string;
}

type Scope = Extract<ReturnType<typeof deriveDeltaScope>, { readonly ok: true }>["value"];
interface ChapterUnits {
  readonly chapter: ChapterChangeScope;
  readonly units: readonly DecisionUnit[];
}
interface ReadyFrame {
  readonly kind: "ready";
  readonly bench: Bench;
  readonly scope: Scope;
  readonly chapters: readonly ChapterUnits[];
  readonly olderChapterCount: number;
  readonly newerChapterCount: number;
  /** A side had CR line endings, which the engine refuses; compared as LF. */
  readonly lineEndingsNormalised: boolean;
  /** Wall time of the Galley work for this pair, for the prototype's own measuring. */
  readonly compareMs: number;
}
interface FailedFrame {
  readonly kind: "failed";
  readonly error: string;
}
type Frame = ReadyFrame | FailedFrame;

const labelPath = (path: string): string => {
  const name = lastSegment(path);
  return name.replace(/^\d+-/u, "").replace(/\.usfm$/iu, "");
};
const dateLabel = (at: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(at);
const firstLine = (message: string): string => message.split("\n", 1)[0] ?? "(no commit message)";
// By id, not by importing the route module: that module lazy-loads this page.
const Route = getRouteApi("/_app/playground/history-diff");

interface Place {
  readonly project?: string;
  readonly book?: string;
  readonly at?: string;
  readonly remote?: string;
}

/** Distinct chapter occurrences on one side of a diff; chapter 0 is the book's opening. */
const chaptersOn = (
  units: readonly DecisionUnit[],
  side: "baselineAddr" | "currentAddr",
): number => {
  const seen = new Set<string>();
  for (const unit of units) {
    const addr = unit[side];
    if (addr !== undefined && addr.chapter > 0) seen.add(`${addr.chapter}:${addr.cdup}`);
  }
  return seen.size;
};

/** How long opening a project waits for a STORED index before going on without it. */
const STORED_INDEX_WAIT_MS = 400;

/** An index entry in the walker's shape: the book's blob after the change. */
const asPathCommit = (commit: IndexedCommit, book: string): PathCommit => {
  const list = commit.changes.find((changes) => changes.some(([name]) => name === book));
  return {
    id: commit.id,
    blob: list?.find(([name]) => name === book)?.[1] ?? null,
    message: commit.subject,
    at: commit.at,
  };
};

/**
 * A merge, read as two lines of work joined (plan primitives 6a and 6b): the
 * common ancestor of its parents, the books each side changed since it, and —
 * for the book on screen, when both sides changed it — the passages both
 * changed. Facts only: what needs review and what may be taken without asking
 * is policy over these (`documentation/architecture/sync.md`).
 */
interface MergeFacts {
  readonly base: IndexedCommit;
  readonly ours: readonly BookChange[];
  readonly theirs: readonly BookChange[];
  readonly both: readonly string[];
  /** Passages of this book changed on both sides, by reference; absent when only one side touched it. */
  readonly passages?: readonly string[];
  readonly ms: number;
}

/** A merge's facts in words, for the slide header. */
const describeMerge = (value: MergeFacts | "working" | string): string => {
  if (value === "working") return "A merge: finding what each side changed…";
  if (typeof value === "string") return value;
  const passages =
    value.passages === undefined
      ? ""
      : ` This book changed on both sides: ${value.passages.length} passage${value.passages.length === 1 ? "" : "s"} changed on both${
          value.passages.length > 0
            ? ` (${value.passages.slice(0, 6).join(", ")}${value.passages.length > 6 ? "…" : ""})`
            : ""
        }.`;
  return `A merge of two lines since ${value.base.id.slice(0, 8)} (${dateLabel(value.base.at)}): ${value.ours.length} books changed on one side, ${value.theirs.length} on the other, ${value.both.length} on both.${passages} (${value.ms.toFixed(0)} ms)`;
};

const shortBook = (name: string): string => name.replace(/^\d+-/u, "").replace(/\.usfm$/iu, "");

/**
 * A string that exists here and nowhere else, so `pnpm verify:design` can ask
 * a real build whether this page got into it (see `SURFACES` in
 * `tools/verify/designBundle.ts`). Rendered as an attribute, not kept as a
 * dead constant, so no minifier can decide it is unused. Do not tidy it away.
 */
const SENTINEL = "__sefer_history_diff_surface__";

export function HistoryDiffPage() {
  return <ShellGate>{() => <ReadyHistoryDiffPage />}</ShellGate>;
}

function ReadyHistoryDiffPage() {
  const services = useShell().services;
  const navigate = useNavigate();
  const search = Route.useSearch();
  const observability = services.composition.observability;
  const baseFs = nodeFsView(services.fileSystem, Effect.runPromise);
  /**
   * Every Git read goes through the pack view (plan primitive 1): the pack
   * files held in memory and loose-object probes answered from one listing,
   * so a walk is ~2 s of compute rather than ~37 s of OPFS round trips. One
   * per project; this route never writes, so nothing invalidates it.
   */
  let pack: PackView = packView(baseFs, "");
  const texts = new BoundedLru<string, string>(
    TEXT_CACHE_LIMIT,
    (text) => text.length,
    TEXT_CACHE_CODE_UNIT_LIMIT,
  );
  // Keyed by the newer commit's id. Not reactive itself: `frameTick` says when it moved.
  const frames = new BoundedLru<string, Frame>(FRAME_LIMIT);

  const [projects, setProjects] = createSignal<readonly LocalProject[]>([], {
    name: "historyProjects",
  });
  const [projectRefresh, setProjectRefresh] = createSignal(0, { name: "historyProjectRefresh" });
  const [books, setBooks] = createSignal<readonly LocalBook[]>([], { name: "historyBooks" });
  const [projectRoot, setProjectRoot] = createSignal("", { name: "historyProjectRoot" });
  const [repo, setRepo] = createSignal<Repo>();
  const [bookPath, setBookPath] = createSignal("", { name: "historyBookPath" });
  const [commits, setCommits] = createSignal<readonly PathCommit[]>([], { name: "historyCommits" });
  const [historyEnd, setHistoryEnd] = createSignal<PathHistoryEnd>();
  const [historyFailure, setHistoryFailure] = createSignal("", { name: "historyFailure" });
  const [historyReading, setHistoryReading] = createSignal(false, { name: "historyReading" });
  const [walked, setWalked] = createSignal(0, { name: "historyWalked" });
  const [frameTick, setFrameTick] = createSignal(0, { name: "historyFrameTick" });
  const [shown, setShown] = createSignal(0, { name: "historyShownSlide" });
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  const [projectBusy, setProjectBusy] = createSignal(false, { name: "historyProjectBusy" });
  const [error, setError] = createSignal("", { name: "historyError" });
  const [remote, setRemote] = createSignal<string>();
  /** The project's book-change index, once `ensureIndex` has it; the walker serves until then. */
  const [index, setIndex] = createSignal<BookIndex>();
  const [indexState, setIndexState] = createSignal("", { name: "historyIndexState" });
  /** Where the open book's history came from, for the header. */
  const [historySource, setHistorySource] = createSignal<"index" | "walk" | "">("", {
    name: "historySource",
  });
  /** Merge facts by merge commit id; `mergeTick` says when one arrived. */
  const merges = new Map<string, MergeFacts | "working" | string>();
  const [mergeTick, setMergeTick] = createSignal(0, { name: "historyMergeTick" });
  // Until the link's own place is reached, the URL is the link's, not ours.
  let restored = false;
  let projectRequest = 0;
  let bookRequest = 0;
  let history: AsyncGenerator<PathCommit, PathHistoryEnd> | undefined;
  // One pull at a time: the generator is not re-entrant.
  let pulling: Promise<void> = Promise.resolve();
  // One comparison at a time: each is a Galley diff on the main thread.
  let comparing: Promise<void> = Promise.resolve();
  const inFlight = new Set<string>();
  // Every change the walk has yielded, whether or not the strip shows it yet:
  // slides appended while the strip animates make Chrome re-snap mid-scroll,
  // several slides off, so `commits` catches up once scrolling has been
  // quiet for a moment. A quiet spell, not `scrollend`, which a re-snap does
  // not always send.
  let found: PathCommit[] = [];
  let lastScroll = 0;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  const QUIET_MS = 150;
  const publishNow = (): void => {
    clearTimeout(publishTimer);
    publishTimer = undefined;
    setCommits([...found]);
    flush();
  };
  const publish = (): void => {
    const wait = lastScroll + QUIET_MS - performance.now();
    if (wait <= 0) publishNow();
    else if (publishTimer === undefined)
      publishTimer = setTimeout(() => {
        publishTimer = undefined;
        publish();
      }, wait);
  };

  const loadProjects = async (): Promise<void> => {
    setProjectBusy(true);
    setError("");
    try {
      const roots = await services.run(services.fileSystem.readDirectory(services.projectsRoot));
      const found: LocalProject[] = [];
      for (const name of roots) {
        if (name.startsWith(".")) continue;
        const root = joinPath(services.projectsRoot, name);
        const hasGit = await services.run(services.fileSystem.exists(joinPath(root, ".git")));
        if (hasGit) found.push({ root, name });
      }
      setProjects(found);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setProjectBusy(false);
    }
  };

  /** The origin, when it is a web URL; credentials are never put in a link. */
  const originOf = async (root: string): Promise<string | undefined> => {
    const config = await services
      .run(services.fileSystem.readFileString(joinPath(root, ".git/config")))
      .catch(() => "");
    const section = /\[remote "origin"\]([^[]*)/u.exec(config)?.[1] ?? "";
    const url = /^\s*url\s*=\s*(\S+)/mu.exec(section)?.[1];
    if (url === undefined || !/^https?:\/\//u.test(url)) return undefined;
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\.git$/u, "");
  };

  /** Open the place the link names: project, then book, then walk back to `at`. */
  const restore = async (): Promise<void> => {
    // One-time reads: a restore acts on the link as it was opened.
    const wanted: Place = untrack(search);
    try {
      if (wanted.project === undefined) return;
      const project = untrack(projects).find((candidate) => candidate.name === wanted.project);
      if (project === undefined) {
        setError(
          `This link is for the project “${wanted.project}”${wanted.remote === undefined ? "" : ` from ${wanted.remote}`}, which is not among this browser's projects. Import it, then open the link again.`,
        );
        return;
      }
      await chooseProject(project.root);
      flush();
      if (wanted.book === undefined || !untrack(books).some((book) => book.path === wanted.book))
        return;
      await chooseBook(wanted.book);
      if (wanted.at !== undefined) await seek(wanted.at);
    } finally {
      restored = true;
    }
  };

  createEffect(
    () => projectRefresh(),
    (count) =>
      void loadProjects().then(() => {
        if (count === 0) void restore();
      }),
  );

  // The URL follows the page: the slide in the middle names the change.
  createEffect(
    () => ({
      project: projectRoot() === "" ? undefined : lastSegment(projectRoot()),
      book: bookPath() === "" ? undefined : bookPath(),
      at: commits()[shown()]?.id.slice(0, 12),
      remote: remote(),
    }),
    (place) => {
      if (!restored) return;
      const next = Object.fromEntries(
        Object.entries(place).filter(([, value]) => value !== undefined),
      );
      void navigate({ to: "/playground/history-diff", search: next, replace: true });
    },
  );

  const resetBook = (): void => {
    ++bookRequest;
    history = undefined;
    frames.clear();
    inFlight.clear();
    found = [];
    clearTimeout(publishTimer);
    publishTimer = undefined;
    setCommits([]);
    setHistoryEnd(undefined);
    setHistoryFailure("");
    setWalked(0);
    setShown(0);
    setHistorySource("");
    setFrameTick((tick) => tick + 1);
  };

  const chooseProject = async (root: string): Promise<void> => {
    const request = ++projectRequest;
    resetBook();
    setProjectRoot(root);
    setBooks([]);
    setRepo(undefined);
    setRemote(undefined);
    setBookPath("");
    setError("");
    setIndex(undefined);
    setIndexState("");
    merges.clear();
    if (root === "") return;
    pack = packView(baseFs, root);
    setProjectBusy(true);
    // The index, in the background: a stored one is a few milliseconds and is
    // waited for (so a link opens from it), a build is seconds in a worker and
    // is not — the walker serves the book until it lands.
    const indexing = ensureIndex({
      fs: pack.fs,
      root,
      observability,
      onProgress: (seen) => {
        if (request === projectRequest)
          setIndexState(`building the history index… ${seen.toLocaleString()} commits`);
      },
    }).then(
      (ensured) => {
        if (request !== projectRequest) return;
        setIndex(ensured.index);
        setIndexState(
          `history index ${ensured.how} · ${ensured.index.commits.length.toLocaleString()} commits`,
        );
      },
      (cause: unknown) => {
        if (request === projectRequest) setIndexState(`history index failed: ${describe(cause)}`);
      },
    );
    await Promise.race([
      indexing,
      new Promise((resolve) => setTimeout(resolve, STORED_INDEX_WAIT_MS)),
    ]);
    try {
      const opened = await services.run(services.git.open(root));
      const entries = await services.run(
        services.fileSystem.readDirectory(root, { recursive: true }),
      );
      if (request !== projectRequest) return;
      setRepo(opened);
      setRemote(await originOf(root));
      setBooks(
        entries
          .filter((path) => path.toLowerCase().endsWith(".usfm"))
          .map((path) => ({ path, label: labelPath(path) }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      );
    } catch (cause) {
      if (request === projectRequest) setError(describe(cause));
    } finally {
      if (request === projectRequest) setProjectBusy(false);
    }
  };

  /** Walk back until `want` book changes are held, the history ends, or it fails. */
  const pull = (want: number, generation: number): Promise<void> => {
    pulling = pulling.then(async () => {
      const source = history;
      if (source === undefined || generation !== bookRequest) return;
      // Read at the moment the pull runs, not tracked: the pull is a queued continuation.
      if (
        untrack(historyEnd) !== undefined ||
        untrack(historyFailure) !== "" ||
        found.length >= want
      )
        return;
      const held = found;
      setHistoryReading(true);
      try {
        while (held.length < want) {
          const step = await source.next();
          if (generation !== bookRequest) return;
          if (step.done === true) {
            setHistoryEnd(step.value);
            break;
          }
          held.push(step.value);
          // Published one at a time: a long walk to the end must not hold back
          // a change it has already found.
          publish();
        }
      } catch (cause) {
        if (generation === bookRequest) setHistoryFailure(describe(cause));
      } finally {
        if (generation === bookRequest) setHistoryReading(false);
      }
    });
    return pulling;
  };

  const chooseBook = async (path: string): Promise<void> => {
    resetBook();
    const request = bookRequest;
    setBookPath(path);
    setError("");
    const heldRepo = repo();
    if (path === "" || heldRepo === undefined) return;
    const relative = Option.getOrUndefined(repositoryPath(heldRepo.root, path));
    if (relative === undefined) {
      setError(`The book path is outside the repository: ${path}`);
      return;
    }
    const held = index();
    if (held !== undefined && !relative.includes("/")) {
      // From the index: the whole history at once, as a graph walk in memory.
      const op = observability.operation("history.book.open", {
        "history.book": relative,
        "history.source": "index",
      });
      const list = bookHistoryFrom(held, relative).map((commit) => asPathCommit(commit, relative));
      found = list;
      setHistorySource("index");
      setHistoryEnd({ walked: held.commits.length, shallowBoundary: held.shallowBoundary });
      publishNow();
      op.end("passed", { "history.changes": list.length });
      return;
    }
    // No index yet: walk, streamed, through the pack view.
    const op = observability.operation("history.book.open", {
      "history.book": relative,
      "history.source": "walk",
    });
    setHistorySource("walk");
    history = pathHistory(pack.fs, heldRepo.root, relative, "HEAD", (count) => {
      if (request === bookRequest) setWalked(count);
    });
    // Two changes make the first slide; the rest arrive as the left edge nears.
    await pull(2, request);
    op.end("passed", { "history.first_changes": found.length });
    void pull(PULL_BATCH, request);
  };

  const textOf = async (commit: PathCommit, dir: string): Promise<string> => {
    if (commit.blob === null) return "";
    const held = texts.get(commit.blob);
    if (held !== undefined) return held;
    const text = new TextDecoder().decode(await readBlobById(pack.fs, dir, commit.blob));
    texts.set(commit.blob, text);
    return text;
  };

  /**
   * A merge's facts, worked out once and on demand: the slide asks when it is
   * drawn, and a merge nobody scrolls to costs nothing.
   */
  const mergeFactsFor = (commit: PathCommit): MergeFacts | "working" | string | undefined => {
    mergeTick();
    const held = index();
    const heldRepo = repo();
    const entry = held === undefined ? undefined : commitsById(held).get(commit.id);
    if (held === undefined || heldRepo === undefined || entry === undefined) return undefined;
    if (entry.parents.length < 2) return undefined;
    const known = merges.get(commit.id);
    if (known !== undefined) return known;
    merges.set(commit.id, "working");
    const [ours, theirs] = entry.parents;
    const book = Option.getOrUndefined(repositoryPath(heldRepo.root, bookPath())) ?? "";
    void (async () => {
      const op = observability.operation("history.merge.facts", {
        "history.merge": commit.id.slice(0, 12),
        "history.book": book,
      });
      const started = performance.now();
      try {
        const finding = op.span("history.merge.base");
        const base =
          ours === undefined || theirs === undefined ? undefined : mergeBase(held, ours, theirs);
        finding({ "merge.base": base?.id.slice(0, 12) ?? "" });
        if (base === undefined || ours === undefined || theirs === undefined) {
          merges.set(commit.id, "No common ancestor in the local history.");
          op.end("passed", { "merge.base_found": false });
          return;
        }
        const listing = op.span("history.merge.books");
        const [mine, other] = await Promise.all([
          booksChangedBetween(pack.fs, heldRepo.root, base.id, ours),
          booksChangedBetween(pack.fs, heldRepo.root, base.id, theirs),
        ]);
        const theirNames = new Set(other.map(([name]) => name));
        const both = mine.map(([name]) => name).filter((name) => theirNames.has(name));
        listing({
          "merge.ours": mine.length,
          "merge.theirs": other.length,
          "merge.both": both.length,
        });
        let passages: readonly string[] | undefined;
        if (both.includes(book)) {
          // For the book on screen: Galley from the ancestor to each side, and
          // the passages whose units changed in both.
          const diffing = op.span("history.merge.passages");
          const textAt = async (id: string | null | undefined) =>
            id === null || id === undefined
              ? ""
              : new TextDecoder()
                  .decode(await readBlobById(pack.fs, heldRepo.root, id))
                  .replace(/\r\n?/gu, "\n");
          const blobOf = (list: readonly BookChange[]) => list.find(([name]) => name === book)?.[1];
          const baseBlob = await blobAt(pack.fs, heldRepo.root, base.id, book);
          const [was, left, right] = await Promise.all([
            textAt(baseBlob),
            textAt(blobOf(mine)),
            textAt(blobOf(other)),
          ]);
          const changedIn = (after: string): Set<string> => {
            const found = services.galley.diff(was, after, { unchanged: true });
            if (Result.isFailure(found)) return new Set();
            return new Set(
              found.success.units
                .filter((unit) => unit.status !== "unchanged")
                .map((unit) => unitReference(unit)),
            );
          };
          const onRight = changedIn(right);
          passages = [...changedIn(left)].filter((reference) => onRight.has(reference));
          diffing({ "merge.passages": passages.length });
        }
        merges.set(commit.id, {
          base,
          ours: mine,
          theirs: other,
          both,
          ...(passages === undefined ? {} : { passages }),
          ms: performance.now() - started,
        });
        op.end("passed", { "merge.both": both.length });
      } catch (cause) {
        merges.set(commit.id, describe(cause));
        op.end("failed", { "history.error": describe(cause) });
      } finally {
        setMergeTick((tick) => tick + 1);
      }
    })();
    return "working";
  };

  /** The other books this commit changed, from the index. */
  const alsoChanged = (commit: PathCommit): readonly string[] => {
    const held = index();
    const entry = held === undefined ? undefined : commitsById(held).get(commit.id);
    if (entry === undefined) return [];
    const book = lastSegment(bookPath());
    return booksOf(entry)
      .map(([name]) => name)
      .filter((name) => name !== book);
  };

  const compare = (olderRaw: string, newerRaw: string): ReadyFrame => {
    // Canonical text is LF and Galley refuses a CR. Old commits often carry
    // CRLF; compare them as LF and say so, rather than show nothing.
    const lineEndingsNormalised = olderRaw.includes("\r") || newerRaw.includes("\r");
    const olderText = lineEndingsNormalised ? olderRaw.replace(/\r\n?/gu, "\n") : olderRaw;
    const newerText = lineEndingsNormalised ? newerRaw.replace(/\r\n?/gu, "\n") : newerRaw;
    // One engine call per pair. `diff` is stateless: historical text never
    // gets registered as, or replaces, a project book in the shared Galley.
    // Its units cover the whole book with both sides' addresses, so the
    // chapter counts come from them rather than from two more parses.
    const diff = services.galley.diff(olderText, newerText, { unchanged: true });
    if (Result.isFailure(diff)) throw diff.failure;
    const olderChapterCount = chaptersOn(diff.success.units, "baselineAddr");
    const newerChapterCount = chaptersOn(diff.success.units, "currentAddr");
    const scope = deriveDeltaScope(olderText, newerText, diff.success);
    if (!scope.ok) throw new Error(`stale pair: ${scope.error}`);
    const bench: Bench = {
      bookId: labelPath(untrack(bookPath)),
      baselineLabel: "before this change",
      currentLabel: "after this change",
      baselineText: olderText,
      currentText: newerText,
      skeleton: diff.success,
      refusal: undefined,
      galley: services.galley,
    };
    const ordered = inOrder(bench);
    return {
      kind: "ready",
      bench,
      scope: scope.value,
      chapters: scope.value.chapters.map((chapter) => {
        const ids = new Set(chapter.unitIds);
        return { chapter, units: ordered.filter((unit) => ids.has(unit.id)) };
      }),
      olderChapterCount,
      newerChapterCount,
      lineEndingsNormalised,
      compareMs: 0,
    };
  };

  /** Compare slide `index` (a change) with the book as it was just before it. */
  const ensureFrame = (index: number): void => {
    const generation = bookRequest;
    const newer = commits()[index];
    const older = commits()[index + 1];
    const heldRepo = repo();
    if (newer === undefined || older === undefined || heldRepo === undefined) return;
    if (inFlight.has(newer.id)) return;
    if (frames.get(newer.id) !== undefined) return; // `get` marks it recent.
    inFlight.add(newer.id);
    comparing = comparing.then(async () => {
      let frame: Frame;
      try {
        const [olderText, newerText] = await Promise.all([
          textOf(older, heldRepo.root),
          textOf(newer, heldRepo.root),
        ]);
        if (generation !== bookRequest) return;
        const started = performance.now();
        const compared = compare(olderText, newerText);
        frame = { ...compared, compareMs: performance.now() - started };
      } catch (cause) {
        frame = { kind: "failed", error: describe(cause) };
      } finally {
        inFlight.delete(newer.id);
      }
      if (generation !== bookRequest) return;
      frames.set(newer.id, frame);
      setFrameTick((tick) => tick + 1);
    });
  };

  // One pair of observers on the strip. A slide within a slide-width of view
  // asks for its comparison; the sentinel past the oldest slide asks the walk
  // for more; the slide across the middle is the one the counter names.
  // Re-observed when the slides change; the cleanup is the effect's return
  // value, as Solid 2 runs `onCleanup` here unowned.
  createEffect(
    () => ({ box: scroller(), count: commits().length }),
    ({ box }) => {
      if (box === undefined) return;
      const generation = bookRequest;
      const near = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
            if (entry.target.dataset.sentinel !== undefined) {
              void pull(found.length + PULL_BATCH, generation);
              continue;
            }
            ensureFrame(Number(entry.target.dataset.slide));
          }
        },
        { root: box, rootMargin: "0px 150% 0px 150%" },
      );
      const centred = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.target instanceof HTMLElement)
              setShown(Number(entry.target.dataset.slide));
          }
        },
        { root: box, rootMargin: "0px -49% 0px -49%" },
      );
      for (const child of box.children) {
        near.observe(child);
        if (child instanceof HTMLElement && child.dataset.slide !== undefined)
          centred.observe(child);
      }
      return () => {
        near.disconnect();
        centred.disconnect();
      };
    },
  );

  const frameOf = (commit: PathCommit): Frame | undefined => {
    frameTick();
    return frames.peek(commit.id);
  };
  /** Slide indexes, newest first; the row is reversed so the latest sits on the right. */
  const slides = createMemo(() =>
    Array.from({ length: Math.max(0, commits().length - 1) }, (_, index) => index),
  );
  // Read ahead of the slide in view, so the left edge is rarely reached at all.
  // The sentinel is not a snap point: if it were, a batch arriving while it
  // was snapped would carry the view to the new far left.
  createEffect(
    () => ({ at: shown(), count: commits().length }),
    ({ at, count }) => {
      if (count >= 2 && at + PULL_BATCH >= count - 1) void pull(at + 2 * PULL_BATCH, bookRequest);
    },
  );
  // Where the buttons are heading. Clicks during a smooth scroll count from
  // here, not from wherever the animation has reached; a finished scroll,
  // including one by hand, clears it.
  let aim: number | undefined;
  createEffect(
    () => scroller(),
    (box) => {
      if (box === undefined) return;
      const moving = (): void => {
        lastScroll = performance.now();
      };
      const settle = (): void => {
        aim = undefined;
      };
      box.addEventListener("scroll", moving, { passive: true });
      box.addEventListener("scrollend", settle);
      return () => {
        box.removeEventListener("scroll", moving);
        box.removeEventListener("scrollend", settle);
      };
    },
  );
  /** Walk back until the change `prefix` names is loaded, then put its slide in the middle. */
  const seek = async (prefix: string): Promise<void> => {
    const generation = bookRequest;
    const indexOf = (): number => found.findIndex((commit) => commit.id.startsWith(prefix));
    while (indexOf() < 0 && generation === bookRequest) {
      flush();
      if (historyEnd() !== undefined || historyFailure() !== "") break;
      await pull(found.length + PULL_BATCH, generation);
    }
    if (generation !== bookRequest) return;
    const index = indexOf();
    if (index < 0) {
      setError(`The change ${prefix} is not in this book's local history.`);
      return;
    }
    // A slide needs the change before it; the first recorded version has none.
    await pull(index + 2, generation);
    const slide = Math.min(index, found.length - 2);
    publishNow();
    scroller()
      ?.querySelector(`[data-slide="${slide}"]`)
      ?.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
  };

  const step = async (direction: -1 | 1): Promise<void> => {
    const next = (aim ?? shown()) - direction;
    if (next < 0) return;
    // Earlier from the oldest loaded slide waits for the walk rather than
    // scrolling onto the sentinel.
    if (next + 1 >= found.length) await pull(next + 2, bookRequest);
    if (next + 1 >= found.length) return;
    // At the loaded edge the view is on the last slide, not mid-animation.
    if (next + 1 >= commits().length) publishNow();
    aim = next;
    scroller()
      ?.querySelector(`[data-slide="${next}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };
  const more = (): string => (historyEnd() === undefined && historyFailure() === "" ? "+" : "");

  /** The change in the middle of the strip, and it as the reader's one book. */
  const shownFrame = (): Frame | undefined => {
    const commit = commits()[shown()];
    return commit === undefined ? undefined : frameOf(commit);
  };
  const [usfm, setUsfm] = createSignal(false, { name: "historyUsfm" });
  const readerBooks = createMemo(
    (): readonly ReviewBook[] => {
      const held = ready(shownFrame());
      if (held === undefined) return [];
      return [
        {
          bookId: held.bench.bookId,
          name: held.bench.bookId,
          currentText: held.bench.currentText,
          baselineText: held.bench.baselineText,
          skeleton: held.bench.skeleton ?? {
            units: [],
            unchangedCount: 0,
            baselineLen: 0,
            currentLen: 0,
            engine: true,
          },
        },
      ];
    },
    { name: "historyReaderBooks" },
  );
  const ready = (frame: Frame | undefined): ReadyFrame | undefined =>
    frame?.kind === "ready" ? frame : undefined;
  const failed = (frame: Frame | undefined): string =>
    frame?.kind === "failed" ? frame.error : "";

  return (
    <div
      class="mx-auto flex max-w-6xl flex-col gap-4 p-4 text-on-surface-primary"
      data-prototype="history-diff"
      data-prototype-surface={SENTINEL}
    >
      <header class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <Badge tone="warning">dev only · read only</Badge>
          <h1 class="text-base font-semibold">Book time travel</h1>
        </div>
        <p class="text-small text-on-surface-secondary">
          Choose a local project and book. Each slide is one commit that changed the book, compared
          with the book as it was just before. Scroll left to go back in time.
        </p>
        <p class="text-smallest text-on-surface-tertiary">
          This route reads Git objects only. It does not open, check out, or write to the selected
          project.
        </p>
      </header>

      <Card class="flex flex-wrap items-center gap-4 p-4">
        <label class="flex items-center gap-2 text-small">
          Project
          <Select
            size="sm"
            wrapperClass="min-w-64"
            value={projectRoot()}
            onChange={(event) => void chooseProject(event.currentTarget.value)}
          >
            <option value="">Choose a local project…</option>
            <For each={projects()}>
              {(project) => <option value={project.root}>{project.name}</option>}
            </For>
          </Select>
        </label>
        <button
          type="button"
          class="rounded border border-surface-border px-2 py-1 text-smallest"
          onClick={() => setProjectRefresh((count) => count + 1)}
        >
          Refresh projects
        </button>
        <label class="flex items-center gap-2 text-small">
          Book
          <Select
            size="sm"
            wrapperClass="w-44"
            value={bookPath()}
            disabled={books().length === 0}
            onChange={(event) => void chooseBook(event.currentTarget.value)}
          >
            <option value="">Choose a book…</option>
            <For each={books()}>{(book) => <option value={book.path}>{book.label}</option>}</For>
          </Select>
        </label>
        <Show when={projectBusy()}>
          <span class="text-smallest text-on-surface-tertiary">Reading the project…</span>
        </Show>
        <Show when={indexState() !== ""}>
          <span class="text-smallest text-on-surface-tertiary" data-index-state>
            {indexState()}
          </span>
        </Show>
        <Show when={bookPath() !== ""}>
          <span class="text-smallest text-on-surface-tertiary">
            {commits().length}
            {more()} book-changing commits
            {historySource() === "index"
              ? " · from the index"
              : historySource() === "walk"
                ? " · walking"
                : ""}
            {historyReading()
              ? ` · reading earlier history (${walked().toLocaleString()} commits walked)…`
              : ""}
          </span>
        </Show>
      </Card>

      <Show when={error()}>
        <Card class="p-4 text-small text-on-surface-error">{error()}</Card>
      </Show>
      <Show when={!projectBusy() && projects().length === 0}>
        <Card class="p-4 text-small text-on-surface-secondary">
          No local Git projects were found under Sefer's projects folder.
        </Card>
      </Show>
      <Show when={historyFailure() !== "" && commits().length < 2}>
        <Card class="p-4 text-small text-on-surface-error">
          Reading this book's history failed: {historyFailure()}
        </Card>
      </Show>
      <Show when={historyEnd() !== undefined && commits().length < 2}>
        <Card class="p-4 text-small text-on-surface-secondary">
          {commits().length === 0
            ? "No commit on the local branch changed this book."
            : "Only one commit on the local branch changed this book, so there is nothing to compare."}
          {historyEnd()?.shallowBoundary
            ? " The walk stopped at this clone's shallow boundary; older changes are not available locally."
            : ""}
        </Card>
      </Show>

      <Show when={commits().length >= 2}>
        <section class="flex flex-col gap-2" aria-label="Book history">
          <div class="flex items-center justify-between gap-2 text-smallest text-on-surface-tertiary">
            <button
              type="button"
              class="rounded border border-surface-border px-3 py-1 text-small"
              onClick={() => void step(-1)}
              aria-label="Earlier book change"
            >
              ← Earlier
            </button>
            <span data-history-position>
              Change {shown() + 1} back from the latest
              {more() === "" ? ` of ${commits().length - 1}` : ""}
            </span>
            <button
              type="button"
              class="rounded border border-surface-border px-3 py-1 text-small disabled:opacity-40"
              disabled={shown() === 0}
              onClick={() => void step(1)}
              aria-label="Later book change"
            >
              Later →
            </button>
          </div>
          <div
            ref={setScroller}
            class="flex snap-x snap-mandatory flex-row-reverse gap-4 overflow-x-auto pb-3"
            role="group"
            aria-label="Book changes, latest on the right"
          >
            <For each={slides()}>
              {(index) => {
                const newer = (): PathCommit | undefined => commits()[index];
                const older = (): PathCommit | undefined => commits()[index + 1];
                const frame = (): Frame | undefined => {
                  const commit = newer();
                  return commit === undefined ? undefined : frameOf(commit);
                };
                return (
                  <article
                    data-slide={index}
                    aria-current={shown() === index ? "true" : undefined}
                    class={
                      shown() === index
                        ? "w-80 shrink-0 snap-center overflow-hidden rounded-md border border-brand bg-surface-primary ring-1 ring-brand"
                        : "w-80 shrink-0 snap-center overflow-hidden rounded-md border border-surface-border bg-surface-primary opacity-80"
                    }
                  >
                    <header class="px-4 py-3">
                      <p class="text-smallest text-on-surface-tertiary">
                        {dateLabel(newer()?.at ?? 0)} · {older()?.id.slice(0, 8)} →{" "}
                        {newer()?.id.slice(0, 8)}
                      </p>
                      <h2 class="mt-1 text-small font-semibold" title={newer()?.message}>
                        {firstLine(newer()?.message ?? "")}
                      </h2>
                      <Show when={newer()}>
                        {(commit) => (
                          <>
                            <Show when={alsoChanged(commit()).length > 0}>
                              <p
                                class="mt-1 text-smallest text-on-surface-tertiary"
                                data-also-changed
                              >
                                Also changed in this commit:{" "}
                                {alsoChanged(commit()).length > 8
                                  ? `${alsoChanged(commit()).length} other books`
                                  : alsoChanged(commit()).map(shortBook).join(", ")}
                              </p>
                            </Show>
                            <Show when={mergeFactsFor(commit())}>
                              {(facts) => (
                                <p
                                  class="mt-1 text-smallest text-on-surface-secondary"
                                  data-merge-facts
                                >
                                  {describeMerge(facts())}
                                </p>
                              )}
                            </Show>
                          </>
                        )}
                      </Show>
                      <p class="mt-1 h-4 text-smallest text-on-surface-tertiary">
                        <Show when={ready(frame())}>
                          {(held) => (
                            <>
                              {held().scope.changedUnits.length} changed units in{" "}
                              {held().chapters.length} chapter locations ·{" "}
                              {held().olderChapterCount} → {held().newerChapterCount} chapters
                              {held().lineEndingsNormalised
                                ? " · CR line endings compared as LF"
                                : ""}
                              <span data-compare-ms={held().compareMs.toFixed(1)}>
                                {` · compared in ${held().compareMs.toFixed(0)} ms`}
                              </span>
                            </>
                          )}
                        </Show>
                      </p>
                    </header>
                    <Show when={failed(frame())}>
                      <p class="px-4 pb-3 text-smallest text-on-surface-error">{failed(frame())}</p>
                    </Show>
                  </article>
                );
              }}
            </For>
            <div
              data-sentinel=""
              class="flex w-56 shrink-0 flex-col justify-center gap-2 p-4 text-smallest text-on-surface-tertiary"
            >
              <Show when={historyFailure()}>
                <p class="text-on-surface-error">
                  Reading earlier history stopped after {commits().length} book changes:{" "}
                  {historyFailure()}
                </p>
              </Show>
              <Show when={historyEnd()}>
                {(end) => (
                  <>
                    <p>
                      First recorded: {dateLabel(commits().at(-1)?.at ?? 0)} ·{" "}
                      {firstLine(commits().at(-1)?.message ?? "")}
                    </p>
                    <p>
                      {commits().length} book-changing commits among {end().walked.toLocaleString()}{" "}
                      commits walked.
                      {end().shallowBoundary
                        ? " The walk stopped at this clone's shallow boundary; older changes are not available locally."
                        : ""}
                    </p>
                  </>
                )}
              </Show>
              <Show when={more() !== ""}>
                <p>
                  {historyReading()
                    ? `Reading earlier history… ${walked().toLocaleString()} commits walked.`
                    : "Scroll here for earlier changes."}
                </p>
              </Show>
            </div>
          </div>
          {/* The change in the middle of the strip, read as Review reads a
              difference: cards or the whole book, side by side when there is
              room (before on the left), or one text. Reading only. */}
          <Show
            when={ready(shownFrame())}
            fallback={
              <p class="p-4 text-smallest text-on-surface-tertiary">
                Comparing with the previous version…
              </p>
            }
          >
            {/* Keyed by the change: each commit is its own comparison, so the
                reader starts at its first change rather than carrying the last
                commit's place over. Layout and scope are preferences and stay. */}
            <Show when={commits()[shown()]?.id} keyed>
              {(commitId) => (
                <div
                  class="flex h-[75vh] min-h-[480px] flex-col"
                  data-history-reader
                  data-commit={commitId}
                >
                  <ReviewReader
                    books={readerBooks()}
                    decision={() => undefined}
                    decide={() => {}}
                    decidable={false}
                    usfm={usfm()}
                    onUsfm={setUsfm}
                    currentLabel="After this change"
                    baselineLabel="Before this change"
                    currentShort="this change"
                    baselineShort="the version before"
                    selected={readerBooks()[0]?.bookId}
                    onSelect={() => {}}
                    seat={() => Promise.resolve(undefined)}
                    onEdited={() => {}}
                    currentFirst={false}
                  />
                </div>
              )}
            </Show>
          </Show>
          <p class="text-smallest text-on-surface-tertiary">
            Held: at most {FRAME_LIMIT} comparisons and {TEXT_CACHE_LIMIT} decoded book texts (
            {TEXT_CACHE_CODE_UNIT_LIMIT / (1024 * 1024)}M UTF-16 code units), keyed by blob id. A
            slide beyond that shows its header until it scrolls back near.
          </p>
        </section>
      </Show>
    </div>
  );
}
