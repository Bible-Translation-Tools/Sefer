/**
 * HostInfo — the facts about the machine we are running on, as one service.
 *
 * `boot()` already answers "which host" and "which build"; this widens that
 * boot half into the whole seam (seams 1.1): where this host lets us write,
 * which language the reader asked for, and which capabilities exist at all.
 * Modules ask HostInfo instead of sniffing globals, which is what keeps the
 * host names inside `src/platform` and out of core policy.
 *
 * The values are supplied by the host at composition time; core only shapes
 * and reads them. Nothing here does IO, so the service is synchronous.
 */
import { Context, Layer } from "effect";

import type { HostKind } from "../boot";

/**
 * POSIX-style directory names, always absolute, never trailing-slashed.
 *
 * They are *names*, not proof of existence: a caller that writes under one
 * creates it first (`makeDirectory({ recursive: true })`). On Web they are
 * OPFS paths rooted at `/sefer`; on desktop they are the OS app directories.
 */
export interface HostPaths {
  readonly appData: string;
  readonly logs: string;
  readonly cache: string;
  readonly temp: string;
}

/**
 * What this host can do — asked before offering a flow, not after it fails.
 *
 * `nativeDisk`: real files outside a sandbox. `nativeGit`: Git through the
 * host rather than isomorphic-git. `fsWatch`: `FileSystem.watch` reports
 * external edits. `dialogs`: a real folder/file picker exists. `secureStore`:
 * credentials can be persisted in an OS keychain rather than a session map.
 */
export interface HostCapabilities {
  readonly nativeDisk: boolean;
  readonly nativeGit: boolean;
  readonly fsWatch: boolean;
  readonly dialogs: boolean;
  readonly secureStore: boolean;
}

/** Everything a host must state about itself. Read once at composition. */
export interface HostInfoValues {
  readonly kind: HostKind;
  readonly build: string;
  readonly paths: HostPaths;
  readonly locale: string;
  readonly capabilities: HostCapabilities;
}

export interface HostInfoService {
  readonly kind: () => HostKind;
  readonly build: () => string;
  readonly paths: () => HostPaths;
  readonly locale: () => string;
  readonly capabilities: () => HostCapabilities;
}

/**
 * The pure constructor. Accessors rather than plain fields because the seam is
 * a port: a later host may compute `locale()` from a live preference, and no
 * caller should have to change when it does.
 */
export const makeHostInfo = (values: HostInfoValues): HostInfoService => ({
  kind: () => values.kind,
  build: () => values.build,
  paths: () => values.paths,
  locale: () => values.locale,
  capabilities: () => values.capabilities,
});

export class HostInfo extends Context.Service<HostInfo, HostInfoService>()("HostInfo") {}

/** The one Layer constructor every host implementation ends up calling. */
export const HostInfoLive = (values: HostInfoValues): Layer.Layer<HostInfo> =>
  Layer.succeed(HostInfo, makeHostInfo(values));
