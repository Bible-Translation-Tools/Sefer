/**
 * The shell's state: the open Project, the services, and the handful of UI
 * choices that outlive a route (mode, clipped chapter, the findings cursor,
 * the status line).
 *
 * Why here and not in the router: TanStack owns navigation, not lifetimes
 * (documentation/architecture/composition.md). A Project owns Book lifetimes
 * and an OPFS handle; a route match is created and destroyed on every
 * navigation, and hanging a Project off one would close books when the user
 * looked at the findings list. So the Project lives above the router and the
 * routes read it.
 *
 * The Solid/Book boundary rule (editor-and-save §1.5) applies to this file
 * too: NOTHING here subscribes to `book.changes`. Only the editor surface
 * does, and when it accepts a receipt it calls `bump()` — one signal the
 * census, the dirty markers and the status bar derive from. That keeps exactly
 * one subscription per book, at the one place that already has to have one.
 */

import { Effect, Fiber, Option, Result, Stream } from "effect";
import {
  createContext,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";

import { ProjectAnalysis } from "../core/analysis/projectAnalysis";
import type { Book, BookId } from "../core/book/book";
import type { Finding } from "../core/findings/finding";
import { navigateTarget } from "../core/findings/findings";
import * as Fixes from "../core/fixes/fixes";
import type { SettingKey } from "../core/host/settings";
import { openProject as openProjectEffect, type Project } from "../core/project/project";
import { DEFAULT_JOURNAL_POLICY, Recovery } from "../core/recovery/recovery";
import { SaveCoordinator } from "../core/save/saveCoordinator";
import { anchorFrom, type EditorBook, type ProjectionName } from "../editor";
import { detectHost } from "../platform/host";
import { registerShellCommands, type ShellBridge } from "./commands";
import { useComposition } from "./CompositionContext";
import { t } from "./i18n";
import { registerProjectCommands } from "./projectCommands";
import { composeServices, fixtureRequested, type Services } from "./services";
import {
  shellKeys,
  REFERENCE_WIDTH,
  SIDEBAR_WIDTH,
  type LastLocation,
  type LastLocations,
  type RecentProjects,
} from "./settings";
import { applyEditorFontSize } from "./ui/theme";

/**
 * Where the editor should put the aimed-at offset.
 *
 * `centre` is what a finding or a search hit wants — the thing is a point in
 * the middle of a page. `top` is what a chapter wants: arriving at Chapter 3
 * means Chapter 3's heading is the first line you read, with the rest of the
 * book below it.
 */
export type RevealAt = "top" | "centre";

/** What the next open of `bookId` should scroll to, and how. */
export interface Reveal {
  readonly bookId: BookId;
  readonly from: number;
  readonly to?: number;
  readonly at?: RevealAt;
}

export interface Shell {
  readonly services: Services;
  readonly project: Accessor<Project | undefined>;
  /** Opening replaces whatever was open; the previous project is closed. */
  readonly openProject: (root: string) => Promise<void>;
  readonly closeProject: () => Promise<void>;

  /** The book the editor route shows, instantiated and journalled. */
  readonly focused: Accessor<EditorBook | undefined>;
  readonly focus: (bookId: BookId | undefined) => Promise<void>;

  /**
   * Has this book changed since it was opened or last written?
   *
   * Exactly `SaveCoordinator.dirty` — the coordinator adopts a baseline when
   * the shell opens a book, so "no baseline" no longer means "just opened".
   * Reading `tick()` is what makes the answer reactive.
   */
  readonly unsaved: (book: Book) => boolean;

  /**
   * The three states a book can be in, now that the file is written only when
   * a version is recorded.
   *
   *   * `unsaved` — the text on screen is not the text in the file.
   *   * `recorded` — the file holds this text and a version holds the file.
   *   * `onDisk` — the file holds this text and NO version does. Reachable
   *     only when a write succeeded and the commit after it did not, which is
   *     the one case a reader has to be told about by name.
   *
   * `recorded` is inferred rather than read from git, and that is the point of
   * the save model: writing the file and recording the version are one action,
   * so a book that matches the file matches the last version too. The one
   * exception is the failed commit, and `noteWritten` is how Save & Review
   * reports it.
   */
  readonly saveState: (book: Book) => "unsaved" | "onDisk" | "recorded";
  /**
   * Save & Review's report after it wrote files: which books reached the disk,
   * and whether a version was recorded for them. Nothing else may call it —
   * the disk is the only other writer of this fact, and it has no opinion
   * about versions.
   */
  readonly noteWritten: (bookIds: readonly BookId[], recorded: boolean) => void;

  readonly mode: Accessor<ProjectionName>;
  readonly setMode: (mode: ProjectionName) => void;
  /** The clipped chapter ordinal, or `null` for the whole book (the default). */
  readonly chapter: Accessor<number | null>;
  readonly setChapter: (ordinal: number | null) => void;
  /**
   * `editor.preferChapterView`, live. Read it to decide how prominent the
   * chapter picker is; the shell itself reads it when it opens a book.
   */
  readonly preferChapterView: Accessor<boolean>;

  /**
   * Where the next book to open should look.
   *
   * Findings and search navigate by URL, and the route that lands calls
   * `focus(bookId)` with no offset — so the offset is left here first and
   * `focus` picks it up. What happens with it is the preference's business:
   * with chapter view ON the book opens clipped to the chapter that contains
   * it, and with chapter view OFF (the default) the whole book is shown and
   * `reveal` names the offset to scroll to.
   */
  /**
   * Where the next open of `bookId` should land. `to` is the END of the thing
   * being aimed at when the caller knows it — a search hit does, a finding
   * does — and it is what the editor marks on arrival; without it there is a
   * position to scroll to and nothing to point at.
   */
  readonly aim: (bookId: BookId, from: number, to?: number, at?: RevealAt) => void;
  readonly reveal: Accessor<Reveal | undefined>;

  /**
   * Go to a chapter of the focused book — the sidebar's grid, the location
   * bar's arrows and its outline all mean this.
   *
   * What "go to" means is the READER's preference, not the caller's: with
   * "Open books one chapter at a time" on it CLIPS to the chapter, and with it
   * off — the default, because a book is one document — it scrolls the
   * chapter's `\c` anchor to the top of the viewport and leaves the rest of
   * the book where it is. Every caller asks for the same thing and this is the
   * one place that decides.
   */
  readonly showChapter: (ordinal: number) => void;

  /**
   * The editor reporting which chapter is at the TOP of its viewport, so that
   * the next open can land back on it.
   *
   * Only `BookEditor` calls it, from the one `watchLocation` subscription it
   * already has for the location bar. The shell keeps no viewport state of its
   * own — this is written straight into the remembered location and read
   * nowhere else.
   */
  readonly noteChapterAtTop: (ordinal: number) => void;

  /**
   * Where the reader last was in `root` — the book, the clip and the chapter
   * that was at the top of the page — or undefined if this device has never
   * had one open there.
   *
   * Written by `focus` and by every chapter change, read by the project route
   * (which sends an Open straight back to the work rather than to a census)
   * and by the rail's panel toggle (which is the way back into a project from
   * a full-page screen). Held as a preference, so it survives a restart.
   */
  readonly lastLocation: (root: string) => LastLocation | undefined;
  /** The path an Open of `root` should land on: the remembered book, or the census. */
  readonly landingPath: (root: string) => string;

  /** The finding the "next/previous finding" commands point at. */
  readonly finding: Accessor<Finding | undefined>;

  /**
   * Bumped whenever the project's text or save state moved. Read it in a route
   * that renders a census, a dirty marker or a diff to make that render
   * reactive without a second subscription to any Book.
   */
  readonly tick: Accessor<number>;
  readonly bump: () => void;

  readonly status: Accessor<string>;
  readonly report: (message: string) => void;
  readonly paletteOpen: Accessor<boolean>;
  readonly setPaletteOpen: (open: boolean) => void;

  /**
   * How many findings the reader is being asked to look at, by rung.
   *
   * The rail's bell and the toolbar's bell both want one number and neither
   * wants to learn the findings module's vocabulary to get it, so the count is
   * derived once here. `tick()` is read for the same reason everything derived
   * here reads it: an edit changes the answer and nothing subscribes to a Book.
   */
  readonly findingCounts: Accessor<{ readonly errors: number; readonly warnings: number }>;

  /**
   * The workspace chrome: is the project sidebar showing, and how wide is it.
   *
   * Both are `workspace.*` preferences (src/app/settings.ts) and both live
   * here for the same reason the mode and the clipped chapter do — the rail
   * that toggles the sidebar and the sidebar itself are in different subtrees
   * of the root route, and a route match is not a lifetime.
   */
  readonly sidebarOpen: Accessor<boolean>;
  readonly setSidebarOpen: (open: boolean) => void;
  /**
   * Is the sidebar actually on screen — the reader's toggle AND something to
   * put in it. With no project open and no history the panel had nothing but
   * an empty book list and a search box that searched it, so it collapses to
   * the rail; `sidebarOpen` keeps the reader's own answer, untouched, for when
   * a project is open again.
   */
  readonly sidebarShowing: Accessor<boolean>;
  /** A fraction of the workspace row; see `SIDEBAR_WIDTH`. */
  readonly sidebarWidth: Accessor<number>;
  readonly setSidebarWidth: (fraction: number) => void;
  /**
   * How wide the reference pane is on the book screen, as a fraction of the
   * editor row; see `REFERENCE_WIDTH`. Same discipline as `sidebarWidth` — the
   * signal moves at pointer speed and the file is written once the drag
   * settles — because it is the same gesture on a different split.
   */
  readonly referenceWidth: Accessor<number>;
  readonly setReferenceWidth: (fraction: number) => void;
  /**
   * The project roots this device has opened, newest first — `shell.recentProjects`
   * read as a list. The landing screen writes the key as it opens a project;
   * the sidebar reads it so a window with nothing open still offers the way
   * back in.
   */
  readonly recentProjects: Accessor<readonly RecentProject[]>;
  /**
   * Is there a newer Sefer? Checked ONCE per session, on the desktop host
   * only, a few seconds after boot, and never awaited by anything: the answer
   * is a pill in the sidebar footer and nothing branches on it.
   */
  readonly updateAvailable: Accessor<boolean>;
}

/** One row of `shell.recentProjects`: a root, its folder name, and when. */
export interface RecentProject {
  readonly root: string;
  readonly name: string;
  readonly at: string;
}

interface Ready {
  readonly kind: "ready";
  readonly shell: Shell;
}

interface Failed {
  readonly kind: "failed";
  readonly reason: string;
}

/** The engine takes a moment and may refuse; the shell has three states. */
export type ShellState = Ready | Failed | { readonly kind: "building" };

/**
 * What the context actually carries.
 *
 * A Solid 2 context value is read when the provider is CREATED, so the
 * provider cannot hand down `undefined` first and the shell later. It hands
 * down this stable handle instead: `state` is the reactive accessor every
 * screen gates on, and `shell` is the assertion-free way to reach the shell
 * once that gate has opened.
 */
interface ShellHandle {
  readonly state: Accessor<ShellState>;
  readonly shell: () => Shell;
}

const ShellContext = createContext<ShellHandle | undefined>(undefined);

const handle = (): ShellHandle => {
  const held = useContext(ShellContext);
  if (held === undefined) throw new Error("useShell() must be called inside a <ProjectProvider>");
  return held;
};

/** The shell's build state. Always available below the provider. */
export const useShellState = (): Accessor<ShellState> => handle().state;

/** The shell itself. Only inside a `ShellGate` — it throws while building. */
export const useShell = (): Shell => handle().shell();

/** Services only, for a component that needs no project state. */
export const useServices = (): Services => useShell().services;

/** The ready shell, or undefined — the shape `<Show when={…}>` wants. */
export const readyShell = (state: ShellState): Shell | undefined =>
  state.kind === "ready" ? state.shell : undefined;

const makeShell = (services: Services, go: (path: string) => void): Shell => {
  const [project, setProject] = createSignal<Project | undefined>(undefined, { name: "project" });
  const [focused, setFocused] = createSignal<EditorBook | undefined>(undefined, {
    name: "focusedBook",
  });
  const [mode, setMode] = createSignal<ProjectionName>("default", { name: "mode" });
  const [chapter, setChapter] = createSignal<number | null>(null, { name: "chapter" });
  const [tick, setTick] = createSignal(0, { name: "tick" });
  const [status, setStatus] = createSignal("", { name: "status" });
  const [paletteOpen, setPaletteOpen] = createSignal(false, { name: "paletteOpen" });
  const [cursor, setCursor] = createSignal(0, { name: "findingCursor" });
  const [reveal, setReveal] = createSignal<Reveal | undefined>(undefined, { name: "reveal" });

  // The one preference the shell reads outside the settings screen. Held in a
  // signal, and kept in step with a forked fiber over `settings.changes`, so
  // turning chapter view on moves the picker's prominence immediately instead
  // of at the next reload.
  const keys = shellKeys(services.settings);
  const [preferChapterView, setPreferChapterView] = createSignal(
    services.settings.get(keys.preferChapterView),
    { name: "preferChapterView" },
  );
  const watching = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.preferChapterView), (on) =>
      Effect.sync(() => setPreferChapterView(on)),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(watching));
  });

  // The working-state backup's timing — the ONE automatic write left in the
  // product, now that the file is written only when a version is recorded.
  // Pushed into Recovery rather than read by it: the journal's debounce fiber
  // is built with the layer, below the settings service, and its two bounds
  // are re-read on every pass, so moving the stepper re-times the next burst.
  const retime = (idleMs: number): Effect.Effect<void> =>
    services.recovery.setPolicy({
      idleMs,
      maxIntervalMs: Math.max(idleMs * 10, DEFAULT_JOURNAL_POLICY.maxIntervalMs),
    });
  const backing = services.runtime.runFork(
    Effect.flatMap(retime(services.settings.get(keys.backupIdleMs)), () =>
      Stream.runForEach(services.settings.changes(keys.backupIdleMs), retime),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(backing));
  });

  // The scripture size. Applied to the document rather than held for a
  // component to read: `src/editor/editor.css` reads `--editor-font-size` for
  // every `.cm-mode-regular` surface, so one write resizes the open book, the
  // reference column and every excerpt satellite at once. The fiber is what
  // makes the stepper on `/settings` move the text under it.
  applyEditorFontSize(services.settings.get(keys.editorFontSize));
  const sizing = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.editorFontSize), (px) =>
      Effect.sync(() => applyEditorFontSize(px)),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(sizing));
  });

  // Which roots this device has opened, newest first. A signal and a fiber
  // for the same reason as above: the landing screen writes the key as it
  // opens a project, and the sidebar beside it must not still be showing the
  // list from before.
  const asRows = (held: RecentProjects): readonly RecentProject[] =>
    Object.entries(held)
      .map(([root, at]) => ({ root, at, name: root.slice(root.lastIndexOf("/") + 1) || root }))
      .sort((left, right) => right.at.localeCompare(left.at));
  const [recentProjects, setRecentProjects] = createSignal<readonly RecentProject[]>(
    asRows(services.settings.get(keys.recentProjects)),
    { name: "recentProjects", equals: false },
  );
  const recents = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.recentProjects), (held) =>
      Effect.sync(() => setRecentProjects(asRows(held))),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(recents));
  });

  // The workspace chrome, seeded from the preferences and written back as the
  // reader moves it. No `settings.changes` fiber like `preferChapterView`
  // above: this shell is the ONLY writer of these two keys — there is no
  // settings widget for either — so the signal cannot fall behind the file.
  const [sidebarOpen, setSidebarOpen] = createSignal(services.settings.get(keys.sidebarOpen), {
    name: "sidebarOpen",
  });
  const [sidebarWidth, setSidebarWidth] = createSignal(services.settings.get(keys.sidebarWidth), {
    name: "sidebarWidth",
  });
  const [referenceWidth, setReferenceWidth] = createSignal(
    services.settings.get(keys.referenceWidth),
    { name: "referenceWidth" },
  );

  // Where the reader was in each project. Same discipline as the two above —
  // this shell is the only writer, so a signal seeded once cannot fall behind
  // the file — and the same `equals: false` as `recentProjects`, because the
  // value is a record replaced wholesale.
  const [locations, setLocations] = createSignal<LastLocations>(
    services.settings.get(keys.lastLocation),
    { name: "lastLocations", equals: false },
  );

  const persist = <S,>(key: SettingKey<S>, value: S): void => {
    // `Effect.result` because a rejected preference is a note, not a crash:
    // the value is already on screen, and the shell's status line is where a
    // refusal belongs.
    void services.run(Effect.result(services.settings.set(key, value)));
  };

  // A drag publishes a fraction per pointer move, and every `settings.set`
  // rewrites the whole preferences file. So the SIGNAL moves at pointer speed
  // and the FILE is written once the drag settles.
  let widthWrite: ReturnType<typeof setTimeout> | undefined;
  let referenceWrite: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (widthWrite !== undefined) clearTimeout(widthWrite);
    if (referenceWrite !== undefined) clearTimeout(referenceWrite);
  });

  // Is there a newer Sefer? One check, on the desktop host only, five seconds
  // after the shell is built — late enough that it never competes with opening
  // a project, and once because a pill in a footer does not need polling. The
  // Web host's `NoUpdaterLive` answers `Unavailable` without a request, so the
  // host test is about honesty rather than cost.
  const [updateAvailable, setUpdateAvailable] = createSignal(false, { name: "updateAvailable" });
  if (detectHost() === "tauri") {
    const askAt = setTimeout(() => {
      void services
        .run(services.updater.check())
        .then((answer) => setUpdateAvailable(answer._tag === "Available"))
        .catch(() => setUpdateAvailable(false));
    }, 5000);
    onCleanup(() => clearTimeout(askAt));
  }

  const report = (message: string): void => {
    setStatus(message);
    services.composition.observability.note("shell.report", "consumed", message);
  };

  const bump = (): void => {
    setTick((held) => held + 1);
  };

  const findings = (): readonly Finding[] => {
    // `tick` is read so the cursor and every panel derived from it recompute
    // after an edit; ProjectAnalysis memoises the list itself.
    tick();
    return project() === undefined ? [] : services.projectAnalysis.findings();
  };

  const findingCounts = (): { readonly errors: number; readonly warnings: number } => {
    let errors = 0;
    let warnings = 0;
    for (const held of findings()) {
      if (held.severity === "error") errors += 1;
      else if (held.severity === "warning") warnings += 1;
    }
    return { errors, warnings };
  };

  const finding = (): Finding | undefined => {
    const list = findings();
    return list.length === 0 ? undefined : list[cursor() % list.length];
  };

  const closeProject = async (): Promise<void> => {
    // A deliberate one-time read: we close exactly the project that was open
    // when the call was made, not whatever is open when the await returns.
    const staticOpen = project();
    setFocused(undefined);
    setProject(undefined);
    if (staticOpen !== undefined) await services.run(staticOpen.close());
  };

  const openProject = async (root: string): Promise<void> => {
    await closeProject();
    const opened = await services.run(
      Effect.result(openProjectEffect(root, { seat: services.seat })),
    );
    if (Result.isFailure(opened)) {
      report(t("could not open {root}: {reason}", { root, reason: opened.failure.reason }));
      return;
    }
    const ready = opened.success;
    // The census, the corpus and every finding come from here; `attach` is what
    // analyses the project once at open (vision §11.1) and keeps it in step.
    await services.run(
      Effect.gen(function* () {
        const analysis = yield* ProjectAnalysis;
        yield* analysis.attach(ready);
      }),
    );
    setProject(ready);
    setCursor(0);
    bump();
    report(t("opened {name} ({count} books)", { name: ready.root, count: ready.books.length }));
  };

  // A book with no adopted baseline was never opened this session: nothing on
  // screen can differ from disk, so it is not "unsaved" — `dirty` alone would
  // badge every untouched book on the project page.
  const unsaved = (book: Book): boolean => {
    tick();
    return Option.isSome(services.save.baseline(book)) && services.save.dirty(book);
  };

  /**
   * Books whose bytes are on disk with no version behind them: a `saveAll`
   * that succeeded under a `git.commit` that did not. A plain Set rather than
   * a signal because every reader of it already reads `tick()`, and Save &
   * Review bumps after both halves of a record.
   */
  const onDisk = new Set<BookId>();

  const noteWritten = (bookIds: readonly BookId[], recorded: boolean): void => {
    for (const bookId of bookIds) {
      if (recorded) onDisk.delete(bookId);
      else onDisk.add(bookId);
    }
    bump();
  };

  const saveState = (book: Book): "unsaved" | "onDisk" | "recorded" => {
    tick();
    if (unsaved(book)) return "unsaved";
    return onDisk.has(book.id) ? "onDisk" : "recorded";
  };

  /**
   * The chapter a book opens on.
   *
   * `null` — the whole book — unless the reader asked for chapter view. A
   * book is one document; clipping it is a preference, not the shape of the
   * thing. When the preference is on, a navigation that named an offset opens
   * on the chapter containing it, and everything else opens on the first.
   */
  const openingChapter = (book: EditorBook, at: number | undefined): number | null => {
    if (!preferChapterView()) return null;
    if (at === undefined) return 0;
    const chapters = book.structure().chapters;
    let found = 0;
    for (const chapter of chapters) if (chapter.from <= at) found = chapter.ordinal;
    return found;
  };

  /** The aim an earlier `focus` already answered; see the read of it below. */
  let honoured: Reveal | undefined;

  const focus = async (bookId: BookId | undefined): Promise<void> => {
    // Another deliberate snapshot: we seat a book in the project that was open
    // when the call was made. Closing a project clears the focus anyway.
    const staticProject = project();
    if (bookId === undefined || staticProject === undefined) {
      setFocused(undefined);
      return;
    }
    const seated = await services.run(
      Effect.gen(function* () {
        const book = yield* Effect.result(staticProject.instantiate(bookId));
        if (Result.isFailure(book)) return undefined;
        const coordinator = yield* SaveCoordinator;
        // The text we just read IS what disk holds, so Save is told so before
        // anything can edit it — otherwise a book nobody has touched reads
        // dirty. `adopt` refuses on a second visit and on a book whose text
        // has already moved, so calling it on every focus is safe.
        yield* coordinator.adopt(book.success);
        // Journalling starts here, not at open: a book nobody is editing has
        // nothing to recover, and the journal fiber belongs to the app scope.
        const recovery = yield* Recovery;
        yield* recovery.attach(book.success, staticProject.id);
        return book.success;
      }),
    );
    // The seat recorded the editor-backed Book as it created it (services.ts),
    // which is how the shell gets an `EditorBook` out of a `Book` port.
    const editing = seated === undefined ? undefined : services.seated(bookId);
    if (editing === undefined) {
      report(t("could not open book {book}", { book: bookId }));
      return;
    }
    setFocused(editing);
    // The aim, if one was left for this book, decides the opening chapter and
    // then stays put for the editor surface to scroll to. An aim is a REQUEST
    // — a finding, a search hit, a chapter click — and a request is answered
    // ONCE: without `honoured`, re-opening the book an aim named scrolled back
    // to it forever, which is precisely what put the remembered place out of
    // reach.
    const aimed = reveal();
    const fresh = aimed !== undefined && aimed !== honoured && aimed.bookId === bookId;
    const at = fresh ? aimed.from : undefined;
    if (!fresh) setReveal(undefined);
    else honoured = aimed;

    /**
     * Where the reader last WAS in this book, when nothing else asked for a
     * place.
     *
     * The aim wins when there is a live one; a remembered scroll position is
     * only the absence of a request. Reopening a project used to land on the
     * top of the right book however far down it the reader had been, because
     * the only thing written down was the CLIP — and a book opens whole.
     */
    const held = lastLocation(staticProject.root);
    const resume = at === undefined && held?.bookId === bookId ? held.at : undefined;

    const opening = openingChapter(editing, at);
    if (preferChapterView() && resume !== undefined) {
      // Chapter view narrows to a chapter, so resuming IS the clip.
      setChapter(resume);
      remember(bookId, resume, resume);
      return;
    }
    setChapter(opening);
    if (resume !== undefined && resume > 0) {
      // Whole-book view scrolls instead: the `\c` anchor of the remembered
      // chapter goes to the top of the viewport, which is exactly what a
      // chapter click does. Marked honoured as it is made, so the next open of
      // the same book asks the remembered location again rather than replaying
      // this scroll.
      const chapter = editing.structure().chapters[resume];
      if (chapter !== undefined) {
        const resumeAim: Reveal = { bookId, from: anchorFrom(chapter), at: "top" };
        setReveal(resumeAim);
        honoured = resumeAim;
      }
    }
    remember(bookId, opening, resume);
  };

  /**
   * Remembers where the reader is, so an Open lands back on it.
   *
   * Called on every focus and every chapter change, which is often — so the
   * write goes through the same debounce the sidebar width uses rather than
   * rewriting the whole preferences file per click.
   */
  let locationWrite: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (locationWrite !== undefined) clearTimeout(locationWrite);
  });

  const remember = (bookId: BookId | undefined, ordinal: number | null, at?: number): void => {
    const root = project()?.root;
    if (root === undefined || bookId === undefined) return;
    const held = locations()[root];
    // The scrolled-to chapter is carried forward when the caller has no
    // opinion about it: a clip change and a scroll are two different facts,
    // and the one that did not happen must not be erased by the one that did.
    const carried = held?.bookId === bookId ? held.at : undefined;
    const where = at ?? carried;
    const next: LastLocations = {
      ...locations(),
      [root]: { bookId, chapter: ordinal, ...(where === undefined ? {} : { at: where }) },
    };
    setLocations(next);
    if (locationWrite !== undefined) clearTimeout(locationWrite);
    locationWrite = setTimeout(() => {
      locationWrite = undefined;
      persist(keys.lastLocation, next);
    }, 400);
  };

  /**
   * The chapter at the top of the viewport, reported by the editor as the
   * reader scrolls.
   *
   * The shell does not measure it and could not: it is a fact about a
   * VIEWPORT, and `watchLocation` (src/editor/recipes/whereAmI.ts) already
   * reads it for the location bar. All that is added here is writing it down,
   * so the next open can land on it. The write is the same debounced one every
   * other location change uses, and a scroll is already coalesced into one
   * animation frame before it gets here.
   */
  const noteChapterAtTop = (ordinal: number): void => {
    const book = focused();
    if (book === undefined) return;
    const root = project()?.root;
    if (root === undefined) return;
    const held = locations()[root];
    if (held?.bookId === book.id && held.at === ordinal) return;
    remember(book.id, untrack(chapter), ordinal);
  };

  const lastLocation = (root: string): LastLocation | undefined => locations()[root];

  /**
   * Where an Open of `root` should land.
   *
   * The remembered book when there is one, and the project's census otherwise.
   * The book is NOT checked against the project here — the project may not be
   * open yet when this is asked — so the route that lands falls back to the
   * census when the book turns out to be gone.
   */
  const landingPath = (root: string): string => {
    const held = lastLocation(root);
    if (held === undefined) return `/project/${encodeURIComponent(root)}`;
    return `/project/${encodeURIComponent(root)}/book/${encodeURIComponent(held.bookId)}`;
  };

  const aim = (bookId: BookId, from: number, to?: number, at?: RevealAt): void => {
    setReveal({ bookId, from, to, at });
  };

  const showChapter = (ordinal: number): void => {
    const book = focused();
    if (book === undefined) return;
    // `ordinal` is written as the scrolled-to chapter as well as the clip:
    // asking for a chapter IS being at it, and waiting for the scroll watcher
    // to say so would lose the answer for a reader who leaves immediately.
    remember(book.id, preferChapterView() ? ordinal : null, ordinal);
    if (preferChapterView()) {
      setChapter(ordinal);
      return;
    }
    const chapter = book.structure().chapters[ordinal];
    if (chapter === undefined) return;
    // A scroll is not a clip, and arriving at a chapter must not silently
    // narrow the book: whatever clip was in force is dropped first.
    setChapter(null);
    aim(book.id, anchorFrom(chapter), undefined, "top");
  };

  const stepFinding = (delta: 1 | -1): void => {
    const list = findings();
    if (list.length === 0) {
      report(t("no findings"));
      return;
    }
    const next = (cursor() + delta + list.length) % list.length;
    setCursor(next);
    const held = list[next];
    if (held === undefined) return;
    const target = navigateTarget(
      held,
      Option.getOrUndefined(services.projectAnalysis.analysis(held.bookId))?.analysis,
    );
    const held_project = project();
    if (held_project === undefined) return;
    aim(target.bookId, target.from);
    go(
      `/project/${encodeURIComponent(held_project.root)}/book/${encodeURIComponent(target.bookId)}`,
    );
    report(t("{code} at {from}", { code: held.code, from: target.from }));
  };

  /**
   * Applies the fix the cursor's finding offers. Every check that matters is
   * `fixes.preview`'s: it refuses a finding computed from text the book has
   * since moved past, which is exactly the mistake a panel invites.
   */
  const applyFix = (): void => {
    const held = finding();
    const book = focused();
    if (held === undefined || book === undefined) return;
    const analysis = Option.getOrUndefined(services.projectAnalysis.analysis(held.bookId));
    if (analysis === undefined) {
      report(t("no analysis for {book}", { book: held.bookId }));
      return;
    }
    const previewed = Fixes.preview(held, book, analysis.analysis);
    if (Result.isFailure(previewed)) {
      report(t("no fix: {reason}", { reason: previewed.failure.reason }));
      return;
    }
    const applied = Fixes.apply(previewed.success, book);
    report(
      Result.isSuccess(applied)
        ? t("applied {label}", { label: previewed.success.label })
        : t("refused by {rule}", { rule: applied.failure.rule }),
    );
    bump();
  };

  const shell: Shell = {
    services,
    project,
    openProject,
    closeProject,
    focused,
    focus,
    unsaved,
    saveState,
    noteWritten,
    mode,
    setMode: (next) => {
      setMode(next);
    },
    chapter,
    setChapter: (ordinal) => {
      setChapter(ordinal);
      remember(focused()?.id, ordinal);
    },
    preferChapterView,
    aim,
    reveal,
    showChapter,
    noteChapterAtTop,
    lastLocation,
    landingPath,
    finding,
    tick,
    bump,
    status,
    report,
    paletteOpen,
    setPaletteOpen: (open) => {
      setPaletteOpen(open);
    },
    findingCounts,
    sidebarOpen,
    setSidebarOpen: (open) => {
      setSidebarOpen(open);
      persist(keys.sidebarOpen, open);
    },
    sidebarShowing: () => sidebarOpen() && (project() !== undefined || recentProjects().length > 0),
    recentProjects,
    updateAvailable,
    sidebarWidth,
    setSidebarWidth: (fraction) => {
      const clamped = Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, fraction));
      setSidebarWidth(clamped);
      if (widthWrite !== undefined) clearTimeout(widthWrite);
      widthWrite = setTimeout(() => {
        widthWrite = undefined;
        persist(keys.sidebarWidth, clamped);
      }, 400);
    },
    referenceWidth,
    setReferenceWidth: (fraction) => {
      const clamped = Math.min(REFERENCE_WIDTH.max, Math.max(REFERENCE_WIDTH.min, fraction));
      setReferenceWidth(clamped);
      if (referenceWrite !== undefined) clearTimeout(referenceWrite);
      referenceWrite = setTimeout(() => {
        referenceWrite = undefined;
        persist(keys.referenceWidth, clamped);
      }, 400);
    },
  };

  const bridge: ShellBridge = {
    services,
    project: () => project(),
    focused: () => focused(),
    mode,
    setMode: shell.setMode,
    chapter,
    setChapter: shell.setChapter,
    chapterCount: () => focused()?.structure().chapters.length ?? 0,
    stepFinding,
    applyFix,
    go,
    openProject,
    setPaletteOpen: shell.setPaletteOpen,
    report,
    bump,
  };

  onCleanup(registerShellCommands(bridge));
  // `project.export` / `project.rename` live for the shell's lifetime. Rename
  // needs a dialog and the landing owns it, so `ask` navigates there with the
  // root in the URL and the landing opens its dialog on arrival.
  onCleanup(
    registerProjectCommands({
      services,
      root: () => project()?.root,
      ask: (root) => go(`/projects?rename=${encodeURIComponent(root)}`),
    }),
  );
  return shell;
};

/**
 * Builds the services once, then the shell.
 *
 * The build is asynchronous because the wasm engine is: `children` is a
 * function so nothing below mounts against a half-built shell, and an engine
 * that will not load renders as a failure rather than as an editor that
 * refuses every parse.
 */
export function ProjectProvider(props: ParentProps<{ readonly go: (path: string) => void }>) {
  const composition = useComposition();
  const [state, setState] = createSignal<ShellState>({ kind: "building" }, { name: "shellState" });
  // The shell registers commands with `onCleanup`, and it is built inside a
  // promise callback — outside any reactive owner. Carrying this component's
  // owner across the await is what keeps that registration disposable.
  const owner = getOwner();

  // The provider can be disposed while the engine is still loading (a test
  // that mounts and unmounts, a route change during boot). Building the shell
  // into a disposed owner would register commands nothing can unregister, and
  // would leak the runtime that holds the wasm engine — so we drop it instead.
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  void composeServices(composition, { fixture: fixtureRequested() })
    .then((services) => {
      if (disposed) {
        void services.dispose();
        return;
      }
      const shell = runWithOwner(owner, () => {
        onCleanup(() => {
          void services.dispose();
        });
        return makeShell(services, props.go);
      });
      if (shell === undefined) return;
      setState({ kind: "ready", shell });
    })
    .catch((cause: unknown) => {
      if (disposed) return;
      const reason = cause instanceof Error ? cause.message : String(cause);
      composition.observability.note("shell.services", "refused", reason);
      setState({ kind: "failed", reason });
    });

  const held: ShellHandle = {
    state,
    // Untracked on purpose. The shell is built exactly once and never
    // replaced, so a screen calling `useShell()` in its body is reading a
    // constant — and `ShellGate` has already proved it exists. Tracking it
    // would only invite Solid to warn about a read that can never change.
    shell: () => {
      const now = untrack(state);
      if (now.kind !== "ready")
        throw new Error(`useShell() while the shell is ${now.kind}; gate on useShellState()`);
      return now.shell;
    },
  };

  return <ShellContext value={held}>{props.children}</ShellContext>;
}
