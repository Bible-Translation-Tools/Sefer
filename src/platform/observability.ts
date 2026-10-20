import type { Result } from "effect";

import type { BootError, BootInfo } from "#core/boot";
import { eventLine, matchesQuery, printSpan } from "#core/observability";
import type {
  AssembledSpan,
  AssemblerSinks,
  ObservabilityEvent,
  ObservabilityService,
  ObservabilitySink,
  TraceQuery,
  Verdict,
} from "#core/observability";

interface NodeRuntime {
  readonly env?: Record<string, string | undefined>;
  readonly stderr?: { readonly write: (chunk: string) => boolean };
}

interface ObservabilityDevSurface {
  readonly traces: {
    readonly recent: (query?: number | TraceQuery) => readonly AssembledSpan[];
    readonly print: (query?: number | TraceQuery) => string;
  };
  readonly logs: { readonly recent: (limit?: number) => readonly ObservabilityEvent[] };
  readonly errors: (limit?: number) => readonly ObservabilityEvent[];
  readonly failures: ObservabilityService["failures"];
  readonly export: ObservabilityService["export"];
  readonly level: ObservabilityService["level"];
  readonly setLevel: ObservabilityService["setLevel"];
  readonly stream: (options: StreamOptions) => void;
}

export interface StreamOptions {
  readonly enabled: boolean;
  readonly filters?: readonly string[];
  readonly exclude?: readonly string[];
  readonly verdicts?: readonly Verdict[];
  readonly alarms?: boolean;
}

export interface DevState {
  readonly boot: Result.Result<BootInfo, BootError>;
  readonly fixture: unknown;
  readonly observability: number;
}

declare global {
  var __sefer:
    | {
        observability?: ObservabilityDevSurface;
        state?: () => DevState;
        design?: unknown;
      }
    | undefined;
}

const nodeRuntime = (): NodeRuntime | undefined => {
  // SAFETY: `process` is only read through this narrowed shape after an `in` check, so a browser or webview host yields undefined instead of throwing.
  const candidate = ("process" in globalThis ? globalThis.process : undefined) as
    | NodeRuntime
    | undefined;
  return candidate?.stderr === undefined ? undefined : candidate;
};

const requested = (runtime: NodeRuntime | undefined, log: string): boolean =>
  (runtime?.env?.SEFER_LOG ?? "") !== "" || log !== "";

const stderrSink = (runtime: NodeRuntime, log: string): ObservabilitySink | undefined => {
  const stderr = runtime.stderr;
  if (stderr === undefined || !requested(runtime, log)) return undefined;
  return (event) => {
    stderr.write(`${eventLine(event)}\n`);
  };
};

export interface ConsoleStream extends AssemblerSinks {
  readonly set: (options: StreamOptions) => void;
}

const MAX_CONSOLE_BACKLOG = 200;

export type Idle = (run: () => void) => void;

export const idle = (): Idle => {
  // SAFETY: `requestIdleCallback` is absent in Safari and in Node, so the shape is narrowed to the one function used and checked before it is called; `setTimeout` is the fallback.
  const held = globalThis as {
    requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number;
  };
  const request = held.requestIdleCallback;
  if (typeof request === "function") return (run) => request(run, { timeout: 500 });
  return (run) => {
    setTimeout(run, 0);
  };
};

const wanted = (name: string, filters: readonly string[], exclude: readonly string[]): boolean => {
  if (exclude.some((prefix) => name.startsWith(prefix))) return false;
  return filters.length === 0 || filters.some((prefix) => name.startsWith(prefix));
};

const streamed = (raw: string): StreamOptions => {
  if (!import.meta.env.DEV) return { enabled: false };
  if (raw === "" || raw === "0" || raw === "false") return { enabled: false };
  if (raw === "1" || raw === "true") return { enabled: true };
  const asked = raw
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one !== "");
  return {
    enabled: true,
    filters: asked.filter((one) => !one.startsWith("!") && !one.startsWith("@")),
    exclude: asked.filter((one) => one.startsWith("!")).map((one) => one.slice(1)),
    // SAFETY: an unknown word after `@` is a verdict that never matches, which is what a typo in a filter should do — print nothing, not throw.
    verdicts: asked.filter((one) => one.startsWith("@")).map((one) => one.slice(1) as Verdict),
  };
};

const alarming = (span: AssembledSpan): boolean =>
  span.verdict === "failed" ||
  span.events.some((one) => one.verdict === "failed") ||
  span.children.some(alarming);

export const consoleStream = (stream = ""): ConsoleStream => {
  const backlog: { readonly head: string; readonly body: unknown; readonly loud: boolean }[] = [];
  const schedule = idle();
  let armed = false;
  const asked = streamed(stream);
  let enabled = asked.enabled;
  let filters: readonly string[] = asked.filters ?? [];
  let exclude: readonly string[] = asked.exclude ?? [];
  let verdicts: readonly Verdict[] = asked.verdicts ?? [];
  let alarms = import.meta.env.DEV;

  const drain = (): void => {
    armed = false;
    for (const one of backlog.splice(0, backlog.length))
      if (one.loud) console.error(one.head, one.body);
      else console.log(one.head, one.body);
  };

  const push = (head: string, body: unknown, loud: boolean): void => {
    if (backlog.length >= MAX_CONSOLE_BACKLOG) return;
    backlog.push({ head, body, loud });
    if (armed) return;
    armed = true;
    schedule(drain);
  };

  const shown = (name: string, verdict: Verdict | undefined): boolean =>
    enabled &&
    wanted(name, filters, exclude) &&
    (verdicts.length === 0 || (verdict !== undefined && verdicts.includes(verdict)));

  return {
    set: (options) => {
      enabled = options.enabled;
      filters = options.filters ?? [];
      exclude = options.exclude ?? [];
      verdicts = options.verdicts ?? [];
      if (options.alarms !== undefined) alarms = import.meta.env.DEV && options.alarms;
      if (!enabled) backlog.length = 0;
    },
    operation: (span) => {
      const loud = alarms && alarming(span);
      if (!loud && !shown(span.name, span.verdict)) return;
      push(`sefer ${span.name}${span.ms === undefined ? "" : ` ${span.ms}ms`}`, span, loud);
    },
    loose: (event) => {
      const loud = alarms && event.verdict === "failed";
      if (!loud && !shown(event.name, event.verdict)) return;
      push(`sefer ${event.name} ${event.verdict ?? ""}`.trimEnd(), event, loud);
    },
  };
};

export interface DevRings {
  readonly sinks: AssemblerSinks;
  readonly traces: (query?: number | TraceQuery) => readonly AssembledSpan[];
  readonly logs: (limit?: number) => readonly ObservabilityEvent[];
}

export const devRings = (capacity = 100): DevRings => {
  const operations: AssembledSpan[] = [];
  const loose: ObservabilityEvent[] = [];
  const take = <T>(held: readonly T[], limit?: number): readonly T[] =>
    limit === undefined ? [...held] : held.slice(Math.max(0, held.length - limit));
  return {
    sinks: {
      operation: (span) => {
        operations.push(span);
        if (operations.length > capacity) operations.shift();
      },
      loose: (event) => {
        loose.push(event);
        if (loose.length > capacity) loose.shift();
      },
    },
    traces: (query) => {
      const asked: TraceQuery = typeof query === "number" ? { limit: query } : (query ?? {});
      const matched = operations.filter((span) => matchesQuery(span, asked));
      return take(matched, asked.limit);
    },
    logs: (limit) => take(loose, limit),
  };
};

export const hostSink = (log = ""): ObservabilitySink | undefined => {
  const runtime = nodeRuntime();
  return runtime === undefined ? undefined : stderrSink(runtime, log);
};

export const installDevState = (state: () => DevState): void => {
  if (!import.meta.env.DEV) return;
  const held = globalThis.__sefer ?? {};
  held.state = state;
  globalThis.__sefer = held;
};

export const installObservabilityDevSurface = (
  service: ObservabilityService,
  rings: DevRings,
  stream: (options: StreamOptions) => void,
): void => {
  if (!import.meta.env.DEV) return;
  const held = globalThis.__sefer ?? {};
  held.observability = {
    traces: {
      recent: rings.traces,
      print: (query = 10) =>
        rings
          .traces(query)
          .map((span) => printSpan(span))
          .join("\n\n"),
    },
    logs: { recent: rings.logs },
    errors: (limit?: number) => {
      const all = service.failures().filter((event) => event.verdict === "failed");
      return limit === undefined ? all : all.slice(-limit);
    },
    failures: service.failures,
    export: service.export,
    level: service.level,
    setLevel: service.setLevel,
    stream,
  };
  globalThis.__sefer = held;
};
