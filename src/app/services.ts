/**
 * The one place the domain Layers are wired together.
 *
 * `src/app/composition.ts` owns boot and Observability and stops there, on
 * purpose (see documentation/architecture/composition.md). This file is the
 * next ring out: it takes the built composition and merges the Web host's
 * capabilities and every core module's Layer over it, then hands the shell
 * plain service objects it can call synchronously.
 *
 * Why one file and not a service registry: the set of services is fixed and
 * small, the wiring order carries real information (who is provided TO whom),
 * and a registry would hide exactly the thing a reader comes here to learn.
 * Every Layer below gets one line saying what it is for.
 *
 * Why the services are handed back as values rather than as Effects: the
 * shell's read path is synchronous — a Solid component cannot await a census —
 * and every service in the list is deliberately synchronous to read. The
 * Effect-shaped operations (open, save, commit) go through `run`.
 */

import { lintGutter } from "@codemirror/lint";
import { Effect, FileSystem, Layer, ManagedRuntime, Result, Scope } from "effect";

import {
  ProjectAdmin,
  ProjectAdminLive,
  type ProjectAdminService,
} from "../core/admin/projectAdmin";
import {
  ProjectAnalysis,
  ProjectAnalysisLive,
  type ProjectAnalysisService,
} from "../core/analysis/projectAnalysis";
import type { BookId } from "../core/book/book";
import { FixtureFileSystemLive, SMALL_NT_ROOT } from "../core/fixture/smallNt";
import {
  Galley,
  type EngineLoadError,
  type GalleyService,
  type VersionMismatch,
} from "../core/galley";
import { Git, type GitService } from "../core/git/git";
import {
  Credentials,
  SessionCredentialsLive,
  type CredentialsService,
} from "../core/host/credentials";
import { Dialogs, type DialogsService } from "../core/host/dialogs";
import { HostInfo, type HostInfoService } from "../core/host/hostInfo";
import { Settings, SettingsLive, type SettingsService } from "../core/host/settings";
import { Observability } from "../core/observability";
import type { Seat } from "../core/project/project";
import { Recovery, RecoveryLive, type RecoveryService } from "../core/recovery/recovery";
import { Library, LibraryLive, type LibraryService } from "../core/resources/library";
import {
  SaveCoordinator,
  SaveCoordinatorLive,
  type SaveCoordinatorService,
} from "../core/save/saveCoordinator";
import { commandsLayer, editorBook, usfmLinter, viewLayer, type EditorBook } from "../editor";
import { WebDialogsLive } from "../platform/web/dialogs";
import { OpfsFileSystemLive } from "../platform/web/fileSystem";
import { WebGalleyLive } from "../platform/web/galley";
import { WebGitLive } from "../platform/web/git";
import { OPFS_ROOT, WEB_PATHS, WebHostInfoLive } from "../platform/web/hostInfo";
import type { Composition } from "./composition";

/**
 * Where the shell looks for projects on the Web host.
 *
 * `WebDialogsLive.pickFolder` returns a picked handle's NAME, not a path the
 * OPFS FileSystem layer can read (its own TODO(seam) says so), so the Web open
 * flow cannot yet open an arbitrary folder on the user's disk. What it can do
 * honestly is list the projects Sefer itself owns, which all live in one OPFS
 * subtree — this one.
 */
export const PROJECTS_ROOT = `${OPFS_ROOT}/projects`;

/** Where the resource library's index and imported resources live. */
export const LIBRARY_ROOT = `${WEB_PATHS.appData}/library`;

/** The engine is the one Layer that can refuse to build. */
export type EngineFailure = EngineLoadError | VersionMismatch;

/** Everything the shell may ask for. Also the `R` of every `run` call. */
export type Domain =
  | Observability
  | FileSystem.FileSystem
  | Galley
  | HostInfo
  | Settings
  | Credentials
  | Dialogs
  | SaveCoordinator
  | Recovery
  | ProjectAnalysis
  | Library
  | Git
  | ProjectAdmin;

export interface Services {
  readonly composition: Composition;
  readonly runtime: ManagedRuntime.ManagedRuntime<Domain, EngineFailure>;
  /**
   * Runs a domain Effect on the application runtime, with the APPLICATION's
   * scope. That is the point: `openProject` and `ProjectAnalysis.attach`
   * require `Scope`, and a per-call `Effect.scoped` would close the project
   * the instant the call returned. Resources acquired through `run` therefore
   * live until `dispose()`.
   */
  readonly run: <A, E>(effect: Effect.Effect<A, E, Domain | Scope.Scope>) => Promise<A>;

  readonly fileSystem: FileSystem.FileSystem;
  readonly galley: GalleyService;
  readonly hostInfo: HostInfoService;
  readonly settings: SettingsService;
  readonly credentials: CredentialsService;
  readonly dialogs: DialogsService;
  readonly save: SaveCoordinatorService;
  readonly recovery: RecoveryService;
  readonly projectAnalysis: ProjectAnalysisService;
  readonly library: LibraryService;
  readonly git: GitService;
  readonly admin: ProjectAdminService;

  /** Plain → Instantiated: `openProject(root, { seat })`. */
  readonly seat: Seat;
  /**
   * The editor-backed Book this seat most recently produced for `id`.
   *
   * `Project.book(id)` returns the `Book` PORT, and the shell's editor surface
   * needs the four things only an `EditorBook` can answer (its state, its
   * structure, `bindView`). Recording them as the seat creates them is how the
   * shell learns that without a type assertion on the port.
   */
  readonly seated: (id: BookId) => EditorBook | undefined;
  /** Which FileSystem this composition got, for the shell to say so. */
  readonly storage: "opfs" | "fixture";
  /** The OPFS subtree the projects list enumerates. */
  readonly projectsRoot: string;
  /**
   * The seeded fixture project's root, when this composition is running over
   * the fixture FileSystem. The projects list offers it as a one-click open,
   * which in a dev build is the shortest route to a real book on screen.
   */
  readonly fixtureProject: string | undefined;
  readonly dispose: () => Promise<void>;
}

export interface ServicesOptions {
  /**
   * DEV only: compose over the seeded in-memory `fixtures/small-nt` instead of
   * OPFS, so a developer (or an agent) can see a real project without first
   * importing one. `?fixture=1` on any route turns it on.
   */
  readonly fixture?: boolean;
}

/** `?fixture=1`, honoured only in a dev build. */
export const fixtureRequested = (): boolean => {
  if (!import.meta.env.DEV || typeof location !== "object") return false;
  return new URLSearchParams(location.search).get("fixture") === "1";
};

/**
 * The Save coordinator, holding the engine's content hash.
 *
 * `Layer.unwrap` rather than a plain merge because `SaveCoordinatorOptions`
 * takes the hasher as a FUNCTION, and the function needs the built Galley —
 * core computes no hash of its own (see documentation/architecture/save.md).
 * The parse this costs is a per-save parse, never a per-keystroke one.
 */
const saveLayer: Layer.Layer<SaveCoordinator, never, FileSystem.FileSystem | Galley> = Layer.unwrap(
  Effect.gen(function* () {
    const galley = yield* Galley;
    return SaveCoordinatorLive({ hasher: (text) => galley.analyze(text).sourceHash });
  }),
);

/**
 * Every domain service, over nothing but what the composition already built.
 * `Observability` is absent from the requirements because every module below
 * takes it through `Effect.serviceOption` — core policy runs with or without
 * the ring — so it is merged back in by the caller for `run`'s sake, not
 * provided as a dependency here.
 */
const domainLayer = (
  build: string,
  fixture: boolean,
): Layer.Layer<Exclude<Domain, Observability>, EngineFailure> => {
  // The host's answers: paths, locale, capabilities. Everything rooted below
  // reads its root from here.
  const hostInfo = WebHostInfoLive(build);

  // Storage. OPFS in a browser; the seeded fixture when a developer asks.
  const fileSystem = fixture ? FixtureFileSystemLive : OpfsFileSystemLive;

  // The host capabilities layer: the pinned wasm engine, the folder/file
  // pickers, and a session-lifetime credential store (the Web host has no
  // secure store, so tokens deliberately do not survive a reload).
  const host = Layer.mergeAll(WebGalleyLive, WebDialogsLive, SessionCredentialsLive, hostInfo);

  // Save must find Recovery, or a crash costs the user everything since the
  // last write: `SaveCoordinatorLive` takes Recovery through `serviceOption`,
  // so it is only journalled when Recovery is IN ITS OWN context — hence
  // provideMerge rather than a sibling merge.
  const saveAndRecovery = Layer.provideMerge(
    saveLayer,
    RecoveryLive({ journalRoot: WEB_PATHS.appData }),
  );

  const modules = Layer.mergeAll(
    // Preferences, decoded through each owner's schema.
    SettingsLive,
    // The project census, the held per-book analyses, and every finding.
    ProjectAnalysisLive,
    // Imported resources and the role bindings a project reads them through.
    LibraryLive({ libraryRoot: LIBRARY_ROOT }),
    // History: isomorphic-git over the same FileSystem port.
    WebGitLive,
    // Rename, delete, metadata, export.
    ProjectAdminLive,
    saveAndRecovery,
  );

  return Layer.provideMerge(modules, Layer.merge(host, fileSystem));
};

/**
 * The build identity the composition already validated, for HostInfo. Read off
 * the boot result rather than re-reading `__SEFER_BUILD__`, so the two can
 * never disagree.
 */
const buildIdentity = (composition: Composition): string =>
  Result.isSuccess(composition.boot) ? composition.boot.success.build : "unknown";

/**
 * Builds the domain services over an existing composition.
 *
 * Rejects when the engine will not load or its wire format does not match the
 * reader — there is no useful Sefer without Galley, and a shell that pretended
 * otherwise would refuse every parse one keystroke at a time. The caller
 * renders the tagged failure.
 */
export const composeServices = async (
  composition: Composition,
  options: ServicesOptions = {},
): Promise<Services> => {
  const fixture = options.fixture ?? false;
  const build = buildIdentity(composition);
  // provideMerge, not provide: `run` may ask for Observability itself, and the
  // composition's ring must stay visible above these modules.
  const layer = Layer.provideMerge(domainLayer(build, fixture), composition.layer);
  const runtime = ManagedRuntime.make(layer);

  const run = <A, E>(effect: Effect.Effect<A, E, Domain | Scope.Scope>): Promise<A> =>
    runtime.runPromise(Effect.provideService(effect, Scope.Scope, runtime.scope));

  // One pass that both forces the whole Layer (so a broken engine fails HERE,
  // at composition, rather than at the first keystroke) and reads out the
  // service values the synchronous shell needs.
  const resolved = await run(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const galley = yield* Galley;
      const hostInfo = yield* HostInfo;
      const settings = yield* Settings;
      const credentials = yield* Credentials;
      const dialogs = yield* Dialogs;
      const save = yield* SaveCoordinator;
      const recovery = yield* Recovery;
      const projectAnalysis = yield* ProjectAnalysis;
      const library = yield* Library;
      const git = yield* Git;
      const admin = yield* ProjectAdmin;
      return {
        fileSystem,
        galley,
        hostInfo,
        settings,
        credentials,
        dialogs,
        save,
        recovery,
        projectAnalysis,
        library,
        git,
        admin,
      };
    }),
  );

  const { galley } = resolved;
  const version = galley.version();
  composition.observability.note(
    "shell.services",
    "ready",
    `${fixture ? "fixture" : "opfs"} galley ${version.engine}`,
  );

  /**
   * The seat: how a plain Book becomes the editor-backed one. A fresh
   * `galley.memoize()` per book keeps one book's memoised parse out of
   * another's.
   */
  // The inline linter needs one @codemirror/state instance shared with
  // @codemirror/lint; vite.config.ts dedupes the package for that reason.
  const mountable = [commandsLayer, viewLayer(), usfmLinter(), lintGutter()];

  const seats = new Map<BookId, EditorBook>();
  const seat: Seat = (plain) => {
    const seated = editorBook(plain, {
      analyze: galley.memoize(),
      observability: composition.observability,
      extensions: mountable,
    });
    seats.set(plain.id, seated);
    return seated;
  };

  return {
    composition,
    runtime,
    run,
    ...resolved,
    seat,
    seated: (id) => seats.get(id),
    storage: fixture ? "fixture" : "opfs",
    projectsRoot: PROJECTS_ROOT,
    fixtureProject: fixture ? SMALL_NT_ROOT : undefined,
    dispose: () => runtime.dispose(),
  };
};
