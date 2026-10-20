import type { Layer } from "effect";

import {
  HostInfoLive,
  type HostCapabilities,
  type HostInfo,
  type HostPaths,
} from "#core/host/hostInfo";

export const OPFS_ROOT = "/sefer";

export const WEB_PATHS: HostPaths = {
  appData: `${OPFS_ROOT}/app`,
  logs: `${OPFS_ROOT}/logs`,
  cache: `${OPFS_ROOT}/cache`,
  temp: `${OPFS_ROOT}/temp`,
};

const DEFAULT_LOCALE = "en";

const webLocale = (): string => {
  // SAFETY: reading one optional property off the global object; every access below is guarded, so a host missing `navigator` yields undefined.
  const host = globalThis as { readonly navigator?: { readonly language?: string } };
  const language = host.navigator?.language;
  return language === undefined || language === "" ? DEFAULT_LOCALE : language;
};

const supportsDirectoryPicker = (): boolean => {
  // SAFETY: an existence probe on the global object; the value is only ever compared against "function", never called through this view.
  const host = globalThis as { readonly showDirectoryPicker?: unknown };
  return typeof host.showDirectoryPicker === "function";
};

const webCapabilities = (): HostCapabilities => ({
  nativeDisk: false,
  nativeGit: false,
  fsWatch: false,
  dialogs: supportsDirectoryPicker(),
  secureStore: false,
});

export const WebHostInfoLive = (build: string): Layer.Layer<HostInfo> =>
  HostInfoLive({
    kind: "web",
    build,
    paths: WEB_PATHS,
    locale: webLocale(),
    capabilities: webCapabilities(),
  });
