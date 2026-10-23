import { Context, Layer } from "effect";

import type { HostKind } from "../boot";

export interface HostPaths {
  readonly appData: string;
  readonly logs: string;
  readonly cache: string;
  readonly temp: string;
}

export interface HostCapabilities {
  readonly nativeDisk: boolean;
  readonly nativeGit: boolean;
  readonly fsWatch: boolean;
  readonly dialogs: boolean;
  readonly secureStore: boolean;
}

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

export const makeHostInfo = (values: HostInfoValues): HostInfoService => ({
  kind: () => values.kind,
  build: () => values.build,
  paths: () => values.paths,
  locale: () => values.locale,
  capabilities: () => values.capabilities,
});

export class HostInfo extends Context.Service<HostInfo, HostInfoService>()("HostInfo") {}

export const HostInfoLive = (values: HostInfoValues): Layer.Layer<HostInfo> =>
  Layer.succeed(HostInfo, makeHostInfo(values));
