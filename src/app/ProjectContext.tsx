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
import { openProject as openProjectEffect, type Project } from "../core/project/project";
import { Recovery } from "../core/recovery/recovery";
import { DEFAULT_AUTOSAVE_POLICY, SaveCoordinator } from "../core/save/saveCoordinator";
import type { EditorBook, ProjectionName } from "../editor";
import { registerShellCommands, type ShellBridge } from "./commands";
import { useComposition } from "./CompositionContext";
import { t } from "./i18n";
import { composeServices, fixtureRequested, type Services } from "./services";
import { shellKeys } from "./settings";

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
   * Has this book changed since it was opened or last saved?
   *
   * Exactly `SaveCoordinator.dirty` — the coordinator adopts a baseline when
   * the shell opens a book, so "no baseline" no longer means "just opened".
   * Reading `tick()` is what makes the answer reactive.
   */
  readonly unsaved: (book: Book) => boolean;

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
  readonly aim: (bookId: BookId, from: number) => void;
  readonly reveal: Accessor<{ readonly bookId: BookId; readonly from: number } | undefined>;

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
  const [reveal, setReveal] = createSignal<{ bookId: BookId; from: number } | undefined>(
    undefined,
    {
      name: "reveal",
    },
  );

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

  const report = (message: string): void => {
    setStatus(message);
    services.composition.observability.note("shell", "consumed", message);
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

  const unsaved = (book: Book): boolean => {
    tick();
    return services.save.dirty(book);
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

  // One autosave fiber per book, in the application scope. `focus` is
  // idempotent, so without this a second visit to the same book would arm a
  // second timer over the same text.
  const armed = new Set<BookId>();

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
        if (!armed.has(bookId)) {
          armed.add(bookId);
          yield* coordinator.autosave(book.success, DEFAULT_AUTOSAVE_POLICY);
        }
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
    // then stays put for the editor surface to scroll to.
    const aimed = reveal();
    const at = aimed?.bookId === bookId ? aimed.from : undefined;
    if (aimed !== undefined && aimed.bookId !== bookId) setReveal(undefined);
    setChapter(openingChapter(editing, at));
  };

  const aim = (bookId: BookId, from: number): void => {
    setReveal({ bookId, from });
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
    mode,
    setMode: (next) => {
      setMode(next);
    },
    chapter,
    setChapter: (ordinal) => {
      setChapter(ordinal);
    },
    preferChapterView,
    aim,
    reveal,
    finding,
    tick,
    bump,
    status,
    report,
    paletteOpen,
    setPaletteOpen: (open) => {
      setPaletteOpen(open);
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
