/**
 * The Web host's answers to HostInfo. This file may touch globals; core may
 * not, which is the entire reason the seam exists.
 *
 * Paths are OPFS paths under one root, so everything Sefer writes in a browser
 * is inspectable and removable as a single subtree. They are names only: the
 * OPFS FileSystem layer creates directories on demand.
 */
import type { Layer } from "effect";

import {
  HostInfoLive,
  type HostCapabilities,
  type HostInfo,
  type HostPaths,
} from "#core/host/hostInfo";

/** Everything Sefer owns in OPFS lives under this one directory. */
export const OPFS_ROOT = "/sefer";

export const WEB_PATHS: HostPaths = {
  appData: `${OPFS_ROOT}/app`,
  logs: `${OPFS_ROOT}/logs`,
  cache: `${OPFS_ROOT}/cache`,
  temp: `${OPFS_ROOT}/temp`,
};

const DEFAULT_LOCALE = "en";

/**
 * A browser without `navigator` is not hypothetical: core tests and SSR both
 * run this module's siblings under Node, and a locale is never worth throwing
 * over.
 */
const webLocale = (): string => {
  // SAFETY: reading one optional property off the global object; every access
  // below is guarded, so a host missing `navigator` yields undefined.
  const host = globalThis as { readonly navigator?: { readonly language?: string } };
  const language = host.navigator?.language;
  return language === undefined || language === "" ? DEFAULT_LOCALE : language;
};

const supportsDirectoryPicker = (): boolean => {
  // SAFETY: an existence probe on the global object; the value is only ever
  // compared against "function", never called through this view.
  const host = globalThis as { readonly showDirectoryPicker?: unknown };
  return typeof host.showDirectoryPicker === "function";
};

/**
 * `nativeGit` is false even though isomorphic-git works here: the flag means
 * "the host runs Git for us", which is the choice a caller actually makes.
 * `fsWatch` is false because OPFS reports no external changes.
 */
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
