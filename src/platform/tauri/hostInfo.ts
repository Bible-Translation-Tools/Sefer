import { appCacheDir, appDataDir, appLogDir, tempDir } from "@tauri-apps/api/path";
import { locale } from "@tauri-apps/plugin-os";
import { Effect, Layer } from "effect";

import { HostInfo, makeHostInfo, type HostCapabilities, type HostPaths } from "#core/host/hostInfo";

const TAURI_CAPABILITIES: HostCapabilities = {
  nativeDisk: true,
  nativeGit: true,
  fsWatch: true,
  dialogs: true,
  secureStore: true,
};

const DEFAULT_LOCALE = "en";

const asPosix = (path: string): string => path.replace(/\\/gu, "/").replace(/\/+$/u, "");

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

export const TauriHostInfoLive = (build: string): Layer.Layer<HostInfo> =>
  Layer.effect(
    HostInfo,
    Effect.gen(function* () {
      const paths = yield* Effect.promise(tauriPaths);
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
