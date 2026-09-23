/**
 * The desktop host's answers to HostInfo — real OS directories, read once.
 *
 * `HostPaths` are names, not proof of existence, so nothing is created here;
 * whoever writes under one calls `makeDirectory({ recursive: true })` first.
 * They come from the OS rather than from a Sefer-chosen subtree because on
 * desktop the operating system already has an opinion about where an
 * application's data belongs, and honouring it is what makes backup,
 * migration and uninstall work.
 *
 * Trailing separators are trimmed and Windows backslashes are normalised to
 * forward slashes, because the whole application joins paths with `/` — see
 * `src/core/fileSystem/path.ts`, which every layer above shares.
 */
import { appCacheDir, appDataDir, appLogDir, tempDir } from "@tauri-apps/api/path";
import { locale } from "@tauri-apps/plugin-os";
import { Effect, Layer } from "effect";

import {
  HostInfo,
  makeHostInfo,
  type HostCapabilities,
  type HostPaths,
} from "../../core/host/hostInfo";

/** Everything the desktop host can do. `none` is not a capability. */
const TAURI_CAPABILITIES: HostCapabilities = {
  nativeDisk: true,
  nativeGit: true,
  fsWatch: true,
  dialogs: true,
  secureStore: true,
};

const DEFAULT_LOCALE = "en";

const asPosix = (path: string): string => path.replace(/\\/gu, "/").replace(/\/+$/u, "");

/**
 * The four directories Tauri resolves for this app id, as POSIX names.
 *
 * Exported separately from the Layer because composition needs them BEFORE it
 * builds anything: the recovery journal, the resource library and the projects
 * list are each rooted at a subdirectory of `appData`, and on desktop that is
 * an OS path rather than a constant Sefer chose.
 */
export const tauriPaths = async (): Promise<HostPaths> => {
  const [appData, logs, cache, temp] = await Promise.all([
    appDataDir(),
    appLogDir(),
    appCacheDir(),
    tempDir(),
  ]);
  return {
    appData: asPosix(appData),
    logs: asPosix(logs),
    cache: asPosix(cache),
    temp: asPosix(temp),
  };
};

/**
 * Builds HostInfo from the four directories Tauri resolves for this app id.
 *
 * `build` is passed in rather than read here for the same reason the Web layer
 * takes it: composition has already validated the build identity through
 * `boot()`, and two readers of `__SEFER_BUILD__` could disagree.
 */
export const TauriHostInfoLive = (build: string): Layer.Layer<HostInfo> =>
  Layer.effect(
    HostInfo,
    Effect.gen(function* () {
      const paths = yield* Effect.promise(tauriPaths);
      // A locale is never worth failing a boot over: the OS may have none set,
      // and the shell's fallback is English.
      const reported = yield* Effect.orElseSucceed(
        Effect.promise(() => locale()),
        () => null,
      );
      return makeHostInfo({
        kind: "tauri",
        build,
        paths,
        locale: reported === null || reported === "" ? DEFAULT_LOCALE : reported,
        capabilities: TAURI_CAPABILITIES,
      });
    }),
  );
