/**
 * TODO(seam): the desktop host's HostInfo. Unwired stub.
 *
 * The real implementation reads the OS app directories through
 * `@tauri-apps/api/path` (`appDataDir`, `appLogDir`, `appCacheDir`, `tempDir`)
 * and the locale through `@tauri-apps/plugin-os`. Neither package is a
 * dependency yet, so this Layer refuses to build rather than answer with paths
 * that would send writes to the wrong place: a settings file written under a
 * guessed directory is worse than a host that will not start.
 *
 * Desktop capabilities, for when the values arrive: nativeDisk true, nativeGit
 * true once the Rust side owns Git, fsWatch true (the fs plugin watches),
 * dialogs true (the dialog plugin), secureStore true (the OS keychain).
 */
import { Effect, Layer } from "effect";

import { HostInfo } from "../../core/host/hostInfo";

const UNIMPLEMENTED =
  "TauriHostInfoLive is a stub: add @tauri-apps/api and read the app directories before composing the desktop host.";

export const TauriHostInfoLive: Layer.Layer<HostInfo> = Layer.effect(
  HostInfo,
  Effect.die(new Error(UNIMPLEMENTED)),
);
