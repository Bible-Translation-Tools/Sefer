import { gestureTrace, seatBook, type EditorBook } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import { Effect, FileSystem, Layer, ManagedRuntime, Option, Result, Scope } from "effect";

import {
  ingredientFor,
  ProjectAdmin,
  ProjectAdminLive,
  type ProjectAdminService,
} from "#core/admin/projectAdmin";
import {
  ProjectAnalysis,
  ProjectAnalysisLive,
  type ProjectAnalysisService,
} from "#core/analysis/projectAnalysis";
import type { HostFacts } from "#core/diagnostics/header";
import { MemoryFileSystemLive } from "#core/fileSystem/memory";
import {
  Galley,
  type EngineLoadError,
  type GalleyService,
  type VersionMismatch,
} from "#core/galley";
import { Git, type GitService } from "#core/git/git";
import { InProcessLockLive, Repositories, RepositoriesLive } from "#core/git/repository";
import { serialiseGit, serialiseRemote } from "#core/git/serialised";
import { Credentials, type CredentialsService } from "#core/host/credentials";
import { Dialogs, type DialogsService } from "#core/host/dialogs";
import { HostInfo, type HostInfoService, type HostPaths } from "#core/host/hostInfo";
import { Settings, SettingsLive, type SettingsService } from "#core/host/settings";
import { NoUpdaterLive, Updater, type UpdaterService } from "#core/host/updater";
import { Observability } from "#core/observability";
import { METADATA_FILE } from "#core/project/discovery";
import type { Seat } from "#core/project/project";
import { Recovery, RecoveryLive, type RecoveryService } from "#core/recovery/recovery";
import { Gitea, GiteaLive, type GiteaService, type HttpFetch } from "#core/remote/gitea";
import { Remote, type RemoteService } from "#core/remote/remote";
import { Suggestions, SuggestionsLive } from "#core/remote/suggestions";
import { parseTransport, through } from "#core/remote/transport";
import { Library, LibraryLive, type LibraryService } from "#core/resources/library";
import {
  SaveCoordinator,
  SaveCoordinatorLive,
  type SaveCoordinatorService,
} from "#core/save/saveCoordinator";
import { detectHost } from "#platform/host";
import { browserFacts } from "#platform/hostFacts";
import { WebCredentialsLive } from "#platform/web/credentials";
import { WebDialogsLive } from "#platform/web/dialogs";
import { OpfsFileSystemLive } from "#platform/web/fileSystem";
import { WebGalleyLive } from "#platform/web/galley";
import { WebGitLive } from "#platform/web/git";
import { OPFS_ROOT, WEB_PATHS, WebHostInfoLive } from "#platform/web/hostInfo";
import { WebLocksLive } from "#platform/web/locks";
import { WebRemoteLive } from "#platform/web/remote";

import type { Composition } from "./composition";
import { startLogFiles, type LogFiles } from "./diagnostics";
import { appIdFor, bootTransport, rememberBootEndpoints, resolveEndpoints } from "./endpoints";
import { env } from "./env";

const PROJECTS_ROOT = `${OPFS_ROOT}/projects`;

const libraryRootIn = (appData: string): string => `${appData}/library`;

type TauriHost = (typeof import("#platform/tauri/index"))["tauriHost"];

const loadTauriHost = async (): Promise<TauriHost> => {
  const { tauriHost } = await import("#platform/tauri/index");
  return tauriHost;
};

type FixtureHost = typeof import("#core/fixture/smallNt");

export type EngineFailure = EngineLoadError | VersionMismatch;

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
  | Repositories
  | Gitea
  | Suggestions
  | Remote
  | ProjectAdmin;

export interface Services {
  readonly composition: Composition;
  readonly runtime: ManagedRuntime.ManagedRuntime<Domain, EngineFailure>;
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
  readonly inMemoryTransfer:
    | ((
        held?: FileSystem.FileSystem,
      ) => Layer.Layer<FileSystem.FileSystem | Git | Remote, never, Credentials | Gitea>)
    | undefined;

  readonly seat: Seat;
  readonly seated: (id: BookId) => EditorBook | undefined;
  readonly storage: "opfs" | "native" | "fixture";
  readonly projectsRoot: string;
  /**
   * The Library's folder: `library.json`, and the copies of source texts and
   * reference material cloned for it. Outside `projectsRoot`, so the projects
   * list never shows them (Will, 2026-10-06).
   */
  readonly libraryRoot: string;
  readonly fixtureProject: string | undefined;
  readonly hostFacts: HostFacts;
  readonly logFiles: LogFiles;
  readonly dispose: () => Promise<void>;
}

export interface ServicesOptions {
  readonly fixture?: boolean;
}

export const fixtureRequested = (): boolean => {
  if (!__SEFER_DESIGN__ || typeof location !== "object") return false;
  return new URLSearchParams(location.search).get("fixture") === "1";
};

const hashOf = (galley: GalleyService): ((text: string) => bigint) => {
  let last: { text: string; hash: bigint } | undefined;
  return (text) => {
    if (last !== undefined && last.text === text) return last.hash;
    const hash = galley.hash(text);
    last = { text, hash };
    return hash;
  };
};

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
      onSaved: (receipt) =>
        Effect.flatMap(ingredientFor(fileSystem, receipt.path), (found) =>
          Option.isNone(found)
            ? Effect.succeed([])
            : Effect.as(admin.refreshChecksums(found.value.root, [found.value.name]), [
                `${found.value.root}/${METADATA_FILE}`,
              ]),
        ),
    });
  }),
);

const domainLayer = (
  build: string,
  fixture: FixtureHost | undefined,
  paths: HostPaths,
  tauri: TauriHost | undefined,
): Layer.Layer<Exclude<Domain, Observability>, EngineFailure> => {
  const hostInfo = tauri === undefined ? WebHostInfoLive(build) : tauri.TauriHostInfoLive(build);

  const platformFileSystem = tauri === undefined ? OpfsFileSystemLive : tauri.TauriFileSystemLive;
  const fileSystem = fixture !== undefined ? fixture.FixtureFileSystemLive : platformFileSystem;

  const webFetch =
    (appId: string): HttpFetch =>
    (input, init) =>
      globalThis.fetch(through(bootTransport(), input), {
        ...init,
        headers: { ...init?.headers, "X-Requested-With": appId },
      });

  const accountFetch =
    tauri === undefined ? webFetch(appIdFor(build)) : globalThis.fetch.bind(globalThis);
  const account = Layer.provideMerge(
    Layer.provideMerge(
      SuggestionsLive({ fetch: accountFetch }),
      GiteaLive({ fetch: accountFetch, platform: tauri === undefined ? "web" : "desktop" }),
    ),
    tauri === undefined ? WebCredentialsLive : tauri.TauriCredentialsLive,
  );

  const engine = WebGalleyLive;

  const host = Layer.mergeAll(
    engine,
    tauri === undefined ? WebDialogsLive : tauri.TauriDialogsLive,
    account,
    hostInfo,
    tauri === undefined
      ? NoUpdaterLive(build)
      : tauri.TauriUpdaterLive({ updaterHost: env.updaterHost }),
    tauri === undefined ? Layer.empty : tauri.TauriFolderTreeLive,
  );

  const saveAndRecovery = Layer.provideMerge(
    saveLayer,
    Layer.merge(
      Layer.unwrap(
        Effect.map(Galley, (galley) =>
          RecoveryLive({
            journalRoot: `${paths.appData}/journals`,
            cause: gestureTrace,
            hasher: hashOf(galley),
          }),
        ),
      ),
      ProjectAdminLive,
    ),
  );

  const modules = Layer.provideMerge(
    Layer.unwrap(
      Effect.map(Settings, (settings) => {
        const endpoints = resolveEndpoints(settings);
        rememberBootEndpoints(endpoints);
        return Layer.mergeAll(
          ProjectAnalysisLive,
          LibraryLive({ libraryRoot: libraryRootIn(paths.appData) }),
          laned(
            tauri === undefined ? WebGitLive : tauri.TauriGitLive,
            tauri === undefined
              ? WebRemoteLive({
                  contentHost: endpoints.contentHost,
                  transport: parseTransport(endpoints.webTransport),
                  appId: appIdFor(build),
                })
              : tauri.TauriRemoteLive({ endpoint: endpoints.contentHost }),
          ),
          saveAndRecovery,
        );
      }),
    ),
    SettingsLive,
  );

  return Layer.provideMerge(modules, Layer.merge(host, fileSystem));
};

const laned = <EG, RG, ER, RR>(
  hostGit: Layer.Layer<Git, EG, RG>,
  hostRemote: Layer.Layer<Remote, ER, RR>,
) => {
  const lock =
    typeof navigator === "object" && "locks" in navigator ? WebLocksLive : InProcessLockLive;
  const repositories = Layer.provide(RepositoriesLive, Layer.merge(hostGit, lock));
  const git = Layer.effect(
    Git,
    Effect.map(Effect.all([Git, Repositories]), ([inner, lanes]) => serialiseGit(inner, lanes)),
  ).pipe(Layer.provide(Layer.merge(hostGit, repositories)));
  const remote = Layer.effect(
    Remote,
    Effect.map(Effect.all([Remote, Repositories]), ([inner, lanes]) =>
      serialiseRemote(inner, lanes),
    ),
  ).pipe(Layer.provide(Layer.merge(hostRemote, repositories)));
  return Layer.mergeAll(git, remote, repositories);
};

const buildIdentity = (composition: Composition): string =>
  Result.isSuccess(composition.boot) ? composition.boot.success.build : "unknown";

export const composeServices = async (
  composition: Composition,
  options: ServicesOptions = {},
): Promise<Services> => {
  const build = buildIdentity(composition);
  const fixture: FixtureHost | undefined =
    __SEFER_DESIGN__ && (options.fixture ?? false)
      ? await import("#core/fixture/smallNt")
      : undefined;
  const tauri: TauriHost | undefined = detectHost() === "tauri" ? await loadTauriHost() : undefined;
  const paths = tauri === undefined ? WEB_PATHS : await tauri.tauriPaths();
  const layer = Layer.provideMerge(domainLayer(build, fixture, paths, tauri), composition.layer);
  const runtime = ManagedRuntime.make(layer);

  const run = <A, E>(effect: Effect.Effect<A, E, Domain | Scope.Scope>): Promise<A> =>
    runtime.runPromise(Effect.provideService(effect, Scope.Scope, runtime.scope));

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
  const platformStorage: Services["storage"] = tauri === undefined ? "opfs" : "native";
  const storageKind: Services["storage"] = fixture ? "fixture" : platformStorage;
  composition.observability.note(
    "shell.services",
    "ready",
    `${storageKind} galley ${version.engine} ${version.tag}`,
  );

  const seats = new Map<BookId, EditorBook>();
  const seat: Seat = (plain) => {
    const seated = seatBook(plain, {
      analyze: galley.memoize(plain.id),
      observability: composition.observability,
    });
    seats.set(plain.id, seated);
    return seated;
  };

  const browser = browserFacts(resolved.hostInfo.kind());
  const hostFacts = tauri === undefined ? browser : await tauri.tauriFacts(browser);
  const logFiles = startLogFiles({
    composition,
    run,
    ...resolved,
    hostFacts,
    storage: storageKind,
  });

  return {
    composition,
    runtime,
    run,
    ...resolved,
    seat,
    seated: (id) => seats.get(id),
    storage: storageKind,
    projectsRoot: tauri === undefined ? PROJECTS_ROOT : `${paths.appData}/projects`,
    libraryRoot: libraryRootIn(paths.appData),
    inMemoryTransfer:
      tauri === undefined
        ? (held) =>
            Layer.provideMerge(
              Layer.merge(
                Layer.fresh(WebGitLive),
                WebRemoteLive({
                  contentHost: resolveEndpoints(resolved.settings).contentHost,
                  transport: bootTransport(),
                  appId: appIdFor(build),
                }),
              ),
              held === undefined
                ? MemoryFileSystemLive()
                : Layer.succeed(FileSystem.FileSystem, held),
            )
        : undefined,
    fixtureProject: fixture?.SMALL_NT_ROOT,
    hostFacts,
    logFiles,
    dispose: async () => {
      await logFiles.flush();
      logFiles.stop();
      await runtime.dispose();
    },
  };
};
