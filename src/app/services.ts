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
import { Effect, FileSystem, Layer, ManagedRuntime, Option, Result, Scope } from "effect";

import {
  ingredientFor,
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
import {
  Galley,
  type EngineLoadError,
  type GalleyService,
  type VersionMismatch,
} from "../core/galley";
import { Git, type GitService } from "../core/git/git";
import { Credentials, type CredentialsService } from "../core/host/credentials";
import { Dialogs, type DialogsService } from "../core/host/dialogs";
import { HostInfo, type HostInfoService, type HostPaths } from "../core/host/hostInfo";
import { Settings, SettingsLive, type SettingsService } from "../core/host/settings";
import { NoUpdaterLive, Updater, type UpdaterService } from "../core/host/updater";
import { Observability } from "../core/observability";
import type { Seat } from "../core/project/project";
import { Recovery, RecoveryLive, type RecoveryService } from "../core/recovery/recovery";
import { Gitea, GiteaLive, type GiteaService, type HttpFetch } from "../core/remote/gitea";
import { Remote, type RemoteService } from "../core/remote/remote";
import { Library, LibraryLive, type LibraryService } from "../core/resources/library";
import {
  SaveCoordinator,
  SaveCoordinatorLive,
  type SaveCoordinatorService,
} from "../core/save/saveCoordinator";
import {
  commandsLayer,
  editorBook,
  lintHoverGrace,
  noteEditing,
  usfmLinter,
  viewLayer,
  type EditorBook,
} from "../editor";
import { detectHost } from "../platform/host";
import { WebCredentialsLive } from "../platform/web/credentials";
import { WebDialogsLive } from "../platform/web/dialogs";
import { OpfsFileSystemLive } from "../platform/web/fileSystem";
import { WebGalleyLive } from "../platform/web/galley";
import { WebGitLive } from "../platform/web/git";
import { OPFS_ROOT, WEB_PATHS, WebHostInfoLive } from "../platform/web/hostInfo";
import { WebRemoteLive } from "../platform/web/remote";
import type { Composition } from "./composition";
import { rememberBootEndpoints, resolveEndpoints } from "./endpoints";
import { env } from "./env";

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

/** Where the resource library's index and imported resources live, on Web. */
export const LIBRARY_ROOT = `${WEB_PATHS.appData}/library`;

/**
 * The desktop host's whole Layer set, as a TYPE only.
 *
 * `typeof import(...)` is erased at compile time, so naming the module here
 * costs a Web bundle nothing. The VALUE arrives through the dynamic
 * `import()` in `composeServices`, inside the `tauri` branch and nowhere else
 * — every file behind that barrel imports `@tauri-apps/*`, which must not be
 * evaluated in a browser.
 */
type TauriHost = typeof import("../platform/tauri/index");

/**
 * The seeded fixture, reached the same way and for the same reason.
 *
 * `fixtures/small-nt` is four real ULB books inlined as `?raw` text — twenty
 * kilobytes that a release has no use for. It was a STATIC import here until
 * 2026-09-22, and a static import puts a module in the graph however
 * unreachable its only caller is: `grep -r "Unlocked Literal Bible" dist/`
 * found it in a production bundle, contradicting the invariant
 * `documentation/agents/verification.md` states.
 *
 * The gate at the import site below is `__SEFER_DESIGN__` and NOT the
 * `fixture` flag, and that distinction is the whole fix. `fixture` is a
 * runtime boolean, so `fixture ? await import(…) : undefined` still emits the
 * chunk — the same way an exported `DESIGN_ENABLED` constant folded at its use
 * site while rolldown shipped the design page anyway. Only the build-time
 * literal lets the branch fold and the module leave the graph.
 */
type FixtureHost = typeof import("../core/fixture/smallNt");

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
  | Updater
  | SaveCoordinator
  | Recovery
  | ProjectAnalysis
  | Library
  | Git
  | Gitea
  | Remote
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
  readonly updater: UpdaterService;
  readonly save: SaveCoordinatorService;
  readonly recovery: RecoveryService;
  readonly projectAnalysis: ProjectAnalysisService;
  readonly library: LibraryService;
  readonly git: GitService;
  readonly gitea: GiteaService;
  readonly remote: RemoteService;
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
  readonly storage: "opfs" | "native" | "fixture";
  /** The subtree the projects list enumerates. */
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

/**
 * `?fixture=1`, honoured in any build that carries the design surface.
 *
 * Widened from `import.meta.env.DEV` on 2026-09-22. The deployed prototype is
 * a production build (`--mode design`), so DEV alone switched this off exactly
 * where it is most useful: on a worker there is no filesystem and no OPFS
 * project to open, and without it every data-bearing screen — the editor,
 * review, the inventory — is an empty state. With it, a link like
 * `/projects?fixture=1` opens four real ULB books over the in-memory
 * `fixtures/small-nt`, which is what makes those screens shareable at all.
 *
 * Still not production: `__SEFER_DESIGN__` is the same build-time literal that
 * gates `/design` itself, so a real release cannot be talked into composing
 * over a fixture by a query parameter.
 */
export const fixtureRequested = (): boolean => {
  if (!__SEFER_DESIGN__ || typeof location !== "object") return false;
  return new URLSearchParams(location.search).get("fixture") === "1";
};

/**
 * The engine hash of a text, parsed at most once per distinct text.
 *
 * `sourceHash` is a byproduct of `parse` — the engine exposes no hash door —
 * so asking for it costs a whole analysis. This was documented as "a per-save
 * parse, never a per-keystroke one" and the trace said otherwise: `dirty` is
 * read reactively through `tick`, so it ran per badged book per keystroke,
 * around four full parses for every key pressed. One entry is enough here:
 * the dirty book is the book being typed in, and `dirty` now settles the
 * clean ones on the revision alone without asking.
 */
const hashOf = (galley: GalleyService): ((text: string) => bigint) => {
  let last: { text: string; hash: bigint } | undefined;
  return (text) => {
    if (last !== undefined && last.text === text) return last.hash;
    const hash = galley.analyze(text, "save.hash").sourceHash;
    last = { text, hash };
    return hash;
  };
};

/**
 * The Save coordinator, holding the engine's content hash.
 *
 * `Layer.unwrap` rather than a plain merge because `SaveCoordinatorOptions`
 * takes the hasher as a FUNCTION, and the function needs the built Galley —
 * core computes no hash of its own (see documentation/architecture/review.md).
 */
const saveLayer: Layer.Layer<
  SaveCoordinator,
  never,
  FileSystem.FileSystem | Galley | ProjectAdmin
> = Layer.unwrap(
  Effect.gen(function* () {
    const galley = yield* Galley;
    const admin = yield* ProjectAdmin;
    const fileSystem = yield* FileSystem.FileSystem;
    return SaveCoordinatorLive({
      hasher: hashOf(galley),
      // The one thing that is wrong the moment a book is written: a Scripture
      // Burrito's ingredient carries the md5 and the size of the file it
      // names. Save must not know what a burrito is, and ProjectAdmin must not
      // know when a save happened, so composition is where the two meet.
      // `ingredientFor` answers both questions at once — which project this
      // path belongs to, and what the ingredient is called inside it — and a
      // path under no `metadata.json` is a folder of loose USFM, not an error.
      onSaved: (receipt) =>
        Effect.flatMap(ingredientFor(fileSystem, receipt.path), (found) =>
          Option.isNone(found)
            ? Effect.void
            : Effect.asVoid(admin.refreshChecksums(found.value.root, [found.value.name])),
        ),
    });
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
  fixture: FixtureHost | undefined,
  paths: HostPaths,
  tauri: TauriHost | undefined,
): Layer.Layer<Exclude<Domain, Observability>, EngineFailure> => {
  // The host's answers: paths, locale, capabilities. Everything rooted below
  // reads its root from here.
  const hostInfo = tauri === undefined ? WebHostInfoLive(build) : tauri.TauriHostInfoLive(build);

  // Storage. Real files on desktop, OPFS in a browser; the seeded fixture when
  // a developer asks, on either host.
  const fileSystem =
    fixture !== undefined
      ? fixture.FixtureFileSystemLive
      : tauri === undefined
        ? OpfsFileSystemLive
        : tauri.TauriFileSystemLive;

  // The host capabilities layer: the pinned wasm engine, the folder/file
  // pickers, and a credential store.
  // Gitea sits in the host ring, not the module ring, because it needs the
  // credential store and the browser's `fetch` — core names neither. The
  // token it mints is called `sefer-web-<yyyymmddThhmmss>`, which is the only
  // string Sefer ever writes into someone's Gitea account; the timestamp is
  // to the second because Gitea refuses a duplicate token NAME, and a
  // day-granular one made a second sign-in from one device impossible.
  /**
   * The transport the Gitea API rides on.
   *
   * It goes to the SAME endpoint the transfers do, through the same door: on
   * the Web that door is a proxy which gates on `X-Requested-With`, so the
   * identifier goes on every request. Before this, git traffic was proxied and
   * the API was not — which meant a successful sign-in was followed by
   * "Failed to fetch" on the very next call, and read like a bad password.
   *
   * Desktop passes `null` and sends no header: it talks to Gitea directly.
   */
  const wacsFetch =
    (appId: string | null): HttpFetch =>
    (input, init) =>
      globalThis.fetch(input, {
        ...init,
        headers: appId === null ? init?.headers : { ...init?.headers, "X-Requested-With": appId },
      });

  const account = Layer.provideMerge(
    GiteaLive({
      fetch: wacsFetch(tauri === undefined ? env.wacsAppId : null),
      platform: tauri === undefined ? "web" : "desktop",
    }),
    // Desktop persists tokens in the OS keychain. The Web host has no secure
    // store and persists to `localStorage` anyway, deliberately: a session
    // that did not survive a reload was not a session. The trade is written
    // out in `src/platform/web/credentials.ts`.
    tauri === undefined ? WebCredentialsLive : tauri.TauriCredentialsLive,
  );

  /**
   * The engine. ONE handle, ONE Layer, in the webview, on both hosts.
   *
   * Desktop used to run the whole-corpus half natively behind Tauri commands,
   * so a publication did not run on the thread that paints the editor. That is
   * gone, and so is the port that made room for it. The id doors are the
   * reason: `parse(id)` and `lint(id)` answer off the text a handle RETAINS,
   * so a corpus living in another process is a corpus the parse path cannot
   * name, and keeping both meant every book's text crossing the wall twice.
   *
   * What we gave up is real — rayon mapped a cold publication's chapters
   * across ten threads and wasm maps them on one. What we got is one resident
   * copy of the project, and a parse path that names a book rather than
   * re-sending it.
   *
   * The way back to an off-thread publication is a Worker, and it is worth
   * being honest that the deleted port would NOT have made that a one-Layer
   * change: a Worker needs the whole corpus on the other side, which is the
   * same thing that made the native door untenable. Whoever builds it is
   * moving the engine, not swapping an implementation.
   */
  const engine = WebGalleyLive;

  const host = Layer.mergeAll(
    engine,
    // Real native pickers on desktop, the File System Access API on Web.
    tauri === undefined ? WebDialogsLive : tauri.TauriDialogsLive,
    account,
    hostInfo,
    // Self-update: real on desktop, an honest refusal in a browser.
    tauri === undefined
      ? NoUpdaterLive(build)
      : tauri.TauriUpdaterLive({ updaterHost: env.updaterHost }),
  );

  // Save must find Recovery, or a crash costs the user everything since the
  // last write: `SaveCoordinatorLive` takes Recovery through `serviceOption`,
  // so it is only journalled when Recovery is IN ITS OWN context — hence
  // provideMerge rather than a sibling merge.
  // ProjectAdmin joins Recovery under Save for the same reason Recovery is
  // there: `SaveCoordinatorLive`'s `onSaved` refreshes the burrito's ingredient
  // checksums, and it can only do that with ProjectAdmin IN ITS OWN context.
  // Both come back out of the merge, so ProjectAdmin is still one instance.
  const saveAndRecovery = Layer.provideMerge(
    saveLayer,
    Layer.merge(RecoveryLive({ journalRoot: paths.appData }), ProjectAdminLive),
  );

  /**
   * Everything else, over Settings.
   *
   * `provideMerge` and `Layer.unwrap` rather than one flat merge because the
   * transfer Layer now takes an endpoint a PREFERENCE may have overridden, and
   * a preference can only be read from a built `Settings`. Settings is still
   * exposed to everything downstream; it is just built first.
   *
   * The endpoint is captured here, once, which is what `bootEndpoints` records
   * and what the settings screen offers a reload against.
   */
  const modules = Layer.provideMerge(
    Layer.unwrap(
      Effect.map(Settings, (settings) => {
        const endpoints = resolveEndpoints(settings, tauri === undefined ? "web" : "tauri");
        rememberBootEndpoints(endpoints);
        return Layer.mergeAll(
          // The project census, the held per-book analyses, and every finding.
          ProjectAnalysisLive,
          // Imported resources and the role bindings a project reads them through.
          LibraryLive({ libraryRoot: `${paths.appData}/library` }),
          // History: git2 through Tauri commands on desktop, isomorphic-git over
          // the same FileSystem port in a browser.
          tauri === undefined ? WebGitLive : tauri.TauriGitLive,
          // Transfer. Both hosts take ONE endpoint: on desktop that is normally
          // Gitea itself, since git2 is not a browser origin; on the Web it is
          // whatever answers on Gitea's paths, which is a proxy wherever
          // something stands in front of the content host.
          tauri === undefined
            ? WebRemoteLive({ endpoint: endpoints.wacsUrl, appId: env.wacsAppId })
            : tauri.TauriRemoteLive({ endpoint: endpoints.wacsUrl }),
          // Save, Recovery, and — rename, delete, metadata, export — ProjectAdmin.
          saveAndRecovery,
        );
      }),
    ),
    // Preferences, decoded through each owner's schema.
    SettingsLive,
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
  const build = buildIdentity(composition);
  /**
   * The fixture, only in a build that carries the design surface at all. The
   * `__SEFER_DESIGN__` half is what makes the module leave a release's graph;
   * see `FixtureHost` above for why the runtime flag alone is not enough.
   */
  const fixture: FixtureHost | undefined =
    __SEFER_DESIGN__ && (options.fixture ?? false)
      ? await import("../core/fixture/smallNt")
      : undefined;
  /**
   * The desktop Layers arrive through a dynamic import so a Web bundle never
   * evaluates — or even fetches — the `@tauri-apps/*` code they sit on. Vite
   * code-splits this, which is exactly the point: `pnpm build` must not carry
   * the plugins.
   */
  const tauri: TauriHost | undefined =
    detectHost() === "tauri" ? await import("../platform/tauri/index") : undefined;
  /**
   * The roots everything writable hangs off, resolved BEFORE the Layers are
   * built because Recovery and Library take theirs as options. On desktop they
   * are the OS app directories; on Web they are the OPFS constants.
   */
  const paths = tauri === undefined ? WEB_PATHS : await tauri.tauriPaths();
  // provideMerge, not provide: `run` may ask for Observability itself, and the
  // composition's ring must stay visible above these modules.
  const layer = Layer.provideMerge(domainLayer(build, fixture, paths, tauri), composition.layer);
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
      const updater = yield* Updater;
      const save = yield* SaveCoordinator;
      const recovery = yield* Recovery;
      const projectAnalysis = yield* ProjectAnalysis;
      const library = yield* Library;
      const git = yield* Git;
      const gitea = yield* Gitea;
      const remote = yield* Remote;
      const admin = yield* ProjectAdmin;
      return {
        fileSystem,
        galley,
        hostInfo,
        settings,
        credentials,
        dialogs,
        updater,
        save,
        recovery,
        projectAnalysis,
        library,
        git,
        gitea,
        remote,
        admin,
      };
    }),
  );

  const { galley } = resolved;
  const version = galley.version();
  const storageKind: Services["storage"] = fixture
    ? "fixture"
    : tauri === undefined
      ? "opfs"
      : "native";
  composition.observability.note(
    "shell.services",
    "ready",
    // The tag, not just the crate name: which engine this build resolved is
    // the first thing a bug report needs. The commit behind the tag is in
    // `pnpm-lock.yaml`, which is where a dependency's identity belongs.
    `${storageKind} galley ${version.engine} ${version.tag}`,
  );

  /**
   * The seat: how a plain Book becomes the editor-backed one. A fresh
   * `galley.memoize()` per book keeps one book's memoised parse out of
   * another's.
   */
  // The inline linter needs one @codemirror/state instance shared with
  // @codemirror/lint; vite.config.ts dedupes the package for that reason.
  const mountable = [
    commandsLayer,
    viewLayer(),
    usfmLinter(),
    lintHoverGrace(),
    lintGutter(),
    // Footnote callers that follow and note bodies that can be typed in. A DOM
    // surface, so it belongs with the mountable half and not in the seat.
    noteEditing(),
  ];

  const seats = new Map<BookId, EditorBook>();
  const seat: Seat = (plain) => {
    const seated = editorBook(plain, {
      analyze: galley.memoize(plain.id),
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
    storage: storageKind,
    // Desktop keeps its own projects beside its other app data; on Web that
    // subtree is all the projects list can honestly enumerate.
    projectsRoot: tauri === undefined ? PROJECTS_ROOT : `${paths.appData}/projects`,
    fixtureProject: fixture?.SMALL_NT_ROOT,
    dispose: () => runtime.dispose(),
  };
};
