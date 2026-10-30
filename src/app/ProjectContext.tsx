import type { ChapterRow, EditorBook, ProjectionName } from "@sefer/editor";
import type { Book, BookId } from "@sefer/text/book";
import type { Address } from "@sefer/text/location/address";
import type { SourceStamp } from "@sefer/text/source";
import {
  createContext,
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";

import type { BookSummary } from "#core/analysis/projectAnalysis";
import type { Finding } from "#core/findings/finding";
import type { Inventory } from "#core/findings/inventory";
import type { Rung } from "#core/findings/suppressions";
import type { Project } from "#core/project/project";
import type { Restorable } from "#core/recovery/recovery";

import { registerShellCommands, type ShellBridge } from "./commands";
import { useComposition } from "./CompositionContext";
import { createResourceHandles, type ResourceHandles } from "./kinds/handles";
import { createLocation, type Location } from "./location";
import { registerProjectCommands } from "./projectCommands";
import { composeServices, fixtureRequested, type Services } from "./services";
import { shellKeys, type LastLocation } from "./settings";
import { createFindingsNav } from "./shell/findingsNav";
import { createLifecycle } from "./shell/lifecycle";
import { createLayoutPreferences, createPreferences } from "./shell/preferences";
import { createReader } from "./shell/reader";
import { createSlugs } from "./shell/slugs";
import type {
  LiveProject,
  Navigate,
  RecentProject,
  Reveal,
  RevealAt,
  RevealCaret,
} from "./shell/types";
import { createUpdateCheck } from "./shell/updateCheck";
import type { ShellEvent } from "./shellEvent";
import { makeShellStores, type SaveState } from "./shellStores";
import { makeSuppressionStore } from "./suppressions";

export type { SaveState } from "./shellStores";

export type { Navigate, RecentProject, Reveal, RevealAt } from "./shell/types";

export interface Shell {
  readonly services: Services;
  readonly project: Accessor<Project | undefined>;
  readonly openProject: (root: string) => Promise<void>;
  readonly recoveryOffer: Accessor<readonly Restorable[] | undefined>;
  readonly setRecoveryOffer: (offer: readonly Restorable[]) => void;
  readonly closeProject: () => Promise<void>;

  readonly focused: Accessor<EditorBook | undefined>;
  readonly focus: (bookId: BookId | undefined) => Promise<void>;

  readonly unsaved: (book: Book) => boolean;

  readonly saveState: (book: Book) => SaveState;
  readonly noteWritten: (bookIds: readonly BookId[], recorded: boolean) => void;

  readonly mode: Accessor<ProjectionName>;
  readonly setMode: (mode: ProjectionName) => void;
  readonly chapter: Accessor<number | null>;
  readonly setChapter: (ordinal: number | null) => void;
  readonly preferChapterView: Accessor<boolean>;
  /** Whole book or one chapter, saved and applied at once (`setChapterScope`, shell/reader.ts). */
  readonly setChapterScope: (one: boolean) => void;
  readonly lineByLine: Accessor<boolean>;
  readonly setLineByLine: (on: boolean) => void;

  readonly aim: (
    bookId: BookId,
    from: number,
    to?: number,
    at?: RevealAt,
    caret?: RevealCaret,
  ) => void;
  readonly reveal: Accessor<Reveal | undefined>;

  readonly showChapter: (ordinal: number) => void;

  readonly showReference: (address: Address) => void;

  readonly location: Location;

  readonly openProjectAtStart: (root: string) => void;

  readonly caret: Accessor<number | undefined>;

  readonly noteCaret: (offset: number | undefined) => void;

  readonly place: Accessor<Address | undefined>;

  readonly resources: ResourceHandles;

  readonly noteChapterAtTop: (ordinal: number, place?: LastLocation["place"]) => void;

  readonly lastLocation: (root: string) => LastLocation | undefined;
  /**
   * Where the editor reopens this book: the last place if it is in this book,
   * or nothing while an aim or a place on its way names the book, because a
   * request always wins over a remembered place.
   */
  readonly resumePlace: (bookId: BookId) => LastLocation["place"];

  readonly finding: Accessor<Finding | undefined>;

  readonly findings: Accessor<readonly Finding[]>;
  readonly findingsPending: Accessor<boolean>;

  readonly suppressedFindings: Accessor<readonly Finding[]>;
  readonly suppress: (finding: Finding, rung: Rung) => Promise<boolean>;
  readonly unsuppress: (id: string) => Promise<boolean>;
  readonly suppressedBy: (finding: Finding) => Rung | undefined;

  readonly changed: (event: ShellEvent) => void;

  readonly report: (message: string) => void;
  readonly paletteOpen: Accessor<boolean>;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly importOpen: Accessor<boolean>;
  readonly setImportOpen: (open: boolean) => void;

  readonly findingCounts: Accessor<{ readonly errors: number; readonly warnings: number }>;

  readonly summaryOf: (bookId: BookId) => BookSummary | undefined;

  readonly bookCensus: Accessor<readonly BookSummary[]>;

  readonly inventory: Accessor<Inventory>;

  readonly stampOf: (bookId: BookId) => SourceStamp | undefined;

  readonly historyDepth: Accessor<{ readonly undo: number; readonly redo: number }>;
  readonly chapterCount: Accessor<number>;

  readonly outline: Accessor<readonly ChapterRow[]>;

  readonly sidebarOpen: Accessor<boolean>;
  readonly setSidebarOpen: (open: boolean) => void;
  readonly sidebarShowing: Accessor<boolean>;
  readonly sidebarWidth: Accessor<number>;
  readonly setSidebarWidth: (fraction: number) => void;
  readonly referenceWidth: Accessor<number>;
  readonly setReferenceWidth: (fraction: number) => void;
  /** The projects page: the loaded projects' share of the row, beside the WACS table. */
  readonly projectsWidth: Accessor<number>;
  readonly setProjectsWidth: (fraction: number) => void;
  /** Refine's language panels split in two, or joined; see `referenceSplit` in settings. */
  readonly referenceSplit: Accessor<boolean>;
  readonly setReferenceSplit: (split: boolean) => void;
  readonly recentProjects: Accessor<readonly RecentProject[]>;

  readonly slugFor: (root: string) => string;
  readonly slug: Accessor<string>;
  readonly rootForSlug: (slug: string) => string | undefined;
  readonly updateAvailable: Accessor<boolean>;
}

interface Ready {
  readonly kind: "ready";
  readonly shell: Shell;
}

interface Failed {
  readonly kind: "failed";
  readonly reason: string;
}

export type ShellState = Ready | Failed | { readonly kind: "building" };

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

export const useShellState = (): Accessor<ShellState> => handle().state;

export const useShell = (): Shell => handle().shell();

export const useServices = (): Services => useShell().services;

export const readyShell = (state: ShellState): Shell | undefined =>
  state.kind === "ready" ? state.shell : undefined;

const NO_CHAPTERS: readonly ChapterRow[] = Object.freeze([]);

const makeShell = (services: Services, navigate: Navigate): Shell => {
  const [project, setProject] = createSignal<Project | undefined>(undefined, { name: "project" });
  const [focused, setFocused] = createSignal<EditorBook | undefined>(undefined, {
    name: "focusedBook",
  });
  const [mode, setMode] = createSignal<ProjectionName>("default", { name: "mode" });
  const [pendingPlace, setPendingPlace] = createSignal<Address | undefined>(undefined, {
    name: "pendingPlace",
  });
  const [chapter, setChapter] = createSignal<number | null>(null, { name: "chapter" });
  const [landOnOpen, setLandOnOpen] = createSignal<string | undefined>(undefined, {
    name: "landOnOpen",
  });
  const location = createLocation(project);

  let live: Project | undefined;
  const liveProject: LiveProject = {
    get: () => live,
    set: (next) => {
      live = next;
    },
  };

  const [paletteOpen, setPaletteOpen] = createSignal(false, { name: "paletteOpen" });
  const [importOpen, setImportOpen] = createSignal(false, { name: "importOpen" });
  const [cursor, setCursor] = createSignal(0, { name: "findingCursor" });
  const [reveal, setReveal] = createSignal<Reveal | undefined>(undefined, { name: "reveal" });

  const keys = shellKeys(services.settings);
  const { preferChapterView, setPreferChapterView, lineByLine, setLineByLine } = createPreferences({
    services,
    keys,
    changed: (event) => changed(event),
    live: liveProject.get,
  });
  const { slugFor, slug, rootForSlug, recentProjects } = createSlugs(services, keys, project);
  const layout = createLayoutPreferences({ services, keys });
  const { updateAvailable } = createUpdateCheck(services);

  const report = (message: string): void => {
    services.composition.observability.note("shell.report", "consumed", message);
  };

  const stores = makeShellStores({ services, open: () => live });
  const {
    changed,
    noteWritten,
    unsaved,
    saveState,
    stampOf,
    findings,
    findingsPending,
    findingCounts,
    summaryOf,
    bookCensus,
    inventory,
  } = stores;
  const suppressions = makeSuppressionStore({ services, changed });
  const suppressedFindings = (): readonly Finding[] => {
    findings();
    return services.projectAnalysis.suppressed();
  };

  const outline = createMemo<readonly ChapterRow[]>(
    () => {
      const book = focused();
      if (book === undefined) return NO_CHAPTERS;
      stampOf(book.id);
      return book.structure().chapters;
    },
    { name: "outline" },
  );

  const resources = createResourceHandles(services);

  const reader = createReader({
    services,
    keys,
    navigate,
    location,
    project,
    focused,
    setFocused,
    chapter,
    setChapter,
    pendingPlace,
    setPendingPlace,
    landOnOpen,
    setLandOnOpen,
    reveal,
    setReveal,
    preferChapterView,
    setPreferChapterView,
    stampOf,
    live: liveProject,
    persist: layout.persist,
    report,
    slug,
    slugFor,
  });
  const { remember, aim } = reader;

  const { recoveryOffer, setRecoveryOffer, closeProject, openProject } = createLifecycle({
    services,
    keys,
    stores,
    suppressions,
    resources,
    project,
    setProject,
    setFocused,
    setCursor,
    live: liveProject,
    report,
    lastLocation: reader.lastLocation,
  });

  const { finding, stepFinding, applyFix } = createFindingsNav({
    services,
    navigate,
    stores,
    project,
    focused,
    cursor,
    setCursor,
    aim,
    slugFor,
    report,
  });

  const shell: Shell = {
    services,
    project,
    openProject,
    recoveryOffer,
    setRecoveryOffer,
    closeProject,
    focused,
    focus: reader.focus,
    unsaved,
    saveState,
    changed,
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
    setChapterScope: reader.setChapterScope,
    lineByLine,
    setLineByLine,
    aim,
    reveal,
    showChapter: reader.showChapter,
    showReference: reader.showReference,
    openProjectAtStart: reader.openProjectAtStart,
    location,
    caret: reader.caret,
    noteCaret: reader.noteCaret,
    place: reader.place,
    resources,
    noteChapterAtTop: reader.noteChapterAtTop,
    lastLocation: reader.lastLocation,
    resumePlace: reader.resumePlace,
    finding,
    findings,
    findingsPending,
    suppressedFindings,
    suppress: (target, rung) => suppressions.suppress(target, rung),
    unsuppress: (id) => suppressions.unsuppress(id),
    suppressedBy: (target) => suppressions.rungOf(target),
    report,
    paletteOpen,
    setPaletteOpen: (open) => {
      setPaletteOpen(open);
    },
    importOpen,
    setImportOpen: (open) => {
      setImportOpen(open);
    },
    findingCounts,
    summaryOf,
    bookCensus,
    inventory,
    stampOf,
    historyDepth: () => {
      const book = focused();
      return book === undefined ? { undo: 0, redo: 0 } : stores.historyDepth(book.id);
    },
    chapterCount: () => outline().length,
    outline,
    sidebarOpen: layout.sidebarOpen,
    setSidebarOpen: layout.setSidebarOpen,
    sidebarShowing: () => layout.sidebarOpen() && project() !== undefined,
    referenceSplit: layout.referenceSplit,
    setReferenceSplit: layout.setReferenceSplit,
    recentProjects,
    slugFor,
    slug,
    rootForSlug,
    updateAvailable,
    sidebarWidth: layout.sidebarWidth,
    setSidebarWidth: layout.setSidebarWidth,
    referenceWidth: layout.referenceWidth,
    setReferenceWidth: layout.setReferenceWidth,
    projectsWidth: layout.projectsWidth,
    setProjectsWidth: layout.setProjectsWidth,
  };

  const bridge: ShellBridge = {
    services,
    slug: shell.slug,
    project: () => project(),
    focused: () => focused(),
    mode,
    setMode: shell.setMode,
    chapter,
    setChapter: shell.setChapter,
    chapterCount: shell.chapterCount,
    historyDepth: shell.historyDepth,
    stepFinding,
    applyFix,
    navigate,
    openProject,
    setPaletteOpen: shell.setPaletteOpen,
    setImportOpen: shell.setImportOpen,
    sidebarOpen: shell.sidebarOpen,
    setSidebarOpen: shell.setSidebarOpen,
    aim,
    report,
    changed,
  };

  onCleanup(registerShellCommands(bridge));
  onCleanup(
    registerProjectCommands({
      services,
      root: () => project()?.root,
      ask: (root) => void navigate({ to: "/projects", search: { rename: root } }),
    }),
  );
  return shell;
};

export function ProjectProvider(props: ParentProps<{ readonly navigate: Navigate }>) {
  const composition = useComposition();
  const [state, setState] = createSignal<ShellState>({ kind: "building" }, { name: "shellState" });
  // Carried across the await below: the shell registers commands with onCleanup, outside any owner otherwise.
  const owner = getOwner();

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
      // oxlint-disable-next-line solid/reactivity
      const shell = runWithOwner(owner, () => {
        onCleanup(() => {
          void services.dispose();
        });
        return makeShell(services, props.navigate);
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
    // Untracked: the shell is built once and never replaced, so this reads a constant.
    shell: () => {
      const now = untrack(state);
      if (now.kind !== "ready")
        throw new Error(`useShell() while the shell is ${now.kind}; gate on useShellState()`);
      return now.shell;
    },
  };

  return <ShellContext value={held}>{props.children}</ShellContext>;
}
