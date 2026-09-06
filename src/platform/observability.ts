import type { Result } from "effect";

import type { BootError, BootInfo } from "../core/boot";
import type { ObservabilityService, ObservabilitySink } from "../core/observability";

interface NodeRuntime {
  readonly env?: Record<string, string | undefined>;
  readonly stderr?: { readonly write: (chunk: string) => boolean };
}

export interface ObservabilityDevSurface {
  readonly recent: ObservabilityService["recent"];
  readonly export: ObservabilityService["export"];
  readonly level: ObservabilityService["level"];
  readonly setLevel: ObservabilityService["setLevel"];
}

export interface DevState {
  readonly boot: Result.Result<BootInfo, BootError>;
  readonly fixture: unknown;
  readonly observability: number;
}

declare global {
  var __sefer: { observability?: ObservabilityDevSurface; state?: () => DevState } | undefined;
}

const nodeRuntime = (): NodeRuntime | undefined => {
  // SAFETY: `process` is only read through this narrowed shape after an `in`
  // check, so a browser or webview host yields undefined instead of throwing.
  const candidate = ("process" in globalThis ? globalThis.process : undefined) as
    | NodeRuntime
    | undefined;
  return candidate?.stderr === undefined ? undefined : candidate;
};

const requested = (runtime: NodeRuntime | undefined): boolean =>
  (runtime?.env?.SEFER_LOG ?? "") !== "" || (import.meta.env.VITE_SEFER_LOG ?? "") !== "";

const stderrSink = (runtime: NodeRuntime): ObservabilitySink | undefined => {
  const stderr = runtime.stderr;
  if (stderr === undefined || !requested(runtime)) return undefined;
  return (_event, line) => {
    stderr.write(line);
  };
};

const consoleSink = (): ObservabilitySink | undefined => {
  if (!import.meta.env.DEV) return undefined;
  return (event) => {
    if (event.kind !== "note") return;
    console.debug(`sefer ${event.name} ${event.verdict ?? ""} ${event.detail ?? ""}`.trimEnd());
  };
};

export const hostSink = (): ObservabilitySink | undefined => {
  const runtime = nodeRuntime();
  return runtime === undefined ? consoleSink() : stderrSink(runtime);
};

export const installDevState = (state: () => DevState): void => {
  if (!import.meta.env.DEV) return;
  const held = globalThis.__sefer ?? {};
  held.state = state;
  globalThis.__sefer = held;
};

export const installObservabilityDevSurface = (service: ObservabilityService): void => {
  if (!import.meta.env.DEV) return;
  const held = globalThis.__sefer ?? {};
  held.observability = {
    recent: service.recent,
    export: service.export,
    level: service.level,
    setLevel: service.setLevel,
  };
  globalThis.__sefer = held;
};
