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

/**
 * What a person or an agent reads out of a running build.
 *
 * Deliberately small. Every surface here answers a question none of the others
 * does. A raw event stream would be a second way to ask what `traces` and
 * `logs` already answer; the editor's own instruments are the hot-path SOURCE,
 * feeding the ring, but not a parallel thing to read.
 */
interface ObservabilityDevSurface {
  /**
   * The operations — end-to-end pieces of work — as NESTED objects: the wide
   * event with its notes as `events` and its spans as `children`. `recent(10)`
   * in a console or over CDP is the whole shape, and nothing a collector sees
   * is missing from it. `print()` is the same, for human eyes.
   */
  readonly traces: {
    readonly recent: (query?: number | TraceQuery) => readonly AssembledSpan[];
    readonly print: (query?: number | TraceQuery) => string;
  };
  /**
   * Everything that belongs to no operation: watchers, bare logs, notes made
   * outside any piece of work. NOT boot — boot is an operation and comes out
   * of `traces`, which is worth saying because this comment named it as an
   * example for long enough to mislead two tests.
   */
  readonly logs: { readonly recent: (limit?: number) => readonly ObservabilityEvent[] };
  /**
   * Every `failed` event — `client.error` notes included — from the failure
   * ring, which ordinary work cannot overwrite. Oldest first.
   */
  readonly errors: (limit?: number) => readonly ObservabilityEvent[];
  /** The whole failure ring: `failed`, `unavailable` and `refused`. Oldest first. */
  readonly failures: ObservabilityService["failures"];
  /** The lossless format: one JSON object per line, every event in the ring. */
  readonly export: ObservabilityService["export"];
  readonly level: ObservabilityService["level"];
  readonly setLevel: ObservabilityService["setLevel"];
  /**
   * Live to the console as work happens, filtered by name prefix. The ring and
   * the collector are untouched by this: it is what THIS console prints, which
   * is the per-sink filter a single global `level` cannot express.
   *
   *   stream({ enabled: true })
   *   stream({ enabled: true, filters: ["editor.mutation"] })
   *   stream({ enabled: true, filters: ["boot", "project.", "save."] })
   */
  readonly stream: (options: StreamOptions) => void;
}

export interface StreamOptions {
  readonly enabled: boolean;
  /** Name prefixes. Empty or absent means everything. */
  readonly filters?: readonly string[];
  /**
   * Name prefixes to leave out, applied after `filters`. Watching everything
   * EXCEPT caret moves is the common case, and listing everything else is not
   * a reasonable way to ask for it.
   */
  readonly exclude?: readonly string[];
  /**
   * Only these outcomes, applied after the names. An operation matches on its
   * own verdict. Empty or absent means any.
   */
  readonly verdicts?: readonly Verdict[];
  /**
   * Whether every `failed` prints as a `console.error` even when the stream
   * is off. On by default in dev; absent leaves it as it was.
   */
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
        /**
         * The design surface's own handle, installed by `src/dev` and typed
         * there. `unknown` here on purpose: platform must not learn the shape
         * of a dev-only tool, and the boundary check would fail the import
         * that taught it. Whoever reads this in a console or over CDP is not
         * consulting these types anyway.
         */
        design?: unknown;
      }
    | undefined;
}

const nodeRuntime = (): NodeRuntime | undefined => {
  // SAFETY: `process` is only read through this narrowed shape after an `in`
  // check, so a browser or webview host yields undefined instead of throwing.
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

/**
 * Operations to the console AS THEY HAPPEN, when asked for.
 *
 * `stream({ enabled: true })` is the whole point: watching work go by while
 * doing it, instead of doing something and then typing `traces.recent()`. The
 * filters say what to PRINT — nothing here changes what the ring keeps or what
 * the collector receives, so turning the stream on never costs evidence and
 * turning it off never loses any.
 *
 * Drained on idle, never on the keystroke path. A `console.debug` per note
 * measured at about a third of the JS work of a keystroke — and worse
 * with DevTools open, which is exactly when someone is reading the number. So
 * an operation appears a frame late rather than inside the frame, and a
 * console that cannot keep up drops rather than queues.
 */
const MAX_CONSOLE_BACKLOG = 200;

export type Idle = (run: () => void) => void;

export const idle = (): Idle => {
  // SAFETY: `requestIdleCallback` is absent in Safari and in Node, so the
  // shape is narrowed to the one function used and checked before it is
  // called; `setTimeout` is the fallback.
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

/**
 * `VITE_SEFER_STREAM`, which is `stream()` without having to type it.
 *
 *   VITE_SEFER_STREAM=1                       everything
 *   VITE_SEFER_STREAM=editor.mutation         one prefix
 *   VITE_SEFER_STREAM=boot,project.,save.     several
 *   VITE_SEFER_STREAM=!editor.selection       everything but caret moves
 *   VITE_SEFER_STREAM=@failed,@unavailable    only those outcomes
 *
 * Its own variable rather than `VITE_SEFER_LOG`, which stays the RAW sink: one
 * writes JSONL to stderr under Node, the other prints trees to a browser
 * console, and wanting one has never implied wanting the other.
 */
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
    // SAFETY: an unknown word after `@` is a verdict that never matches, which
    // is what a typo in a filter should do — print nothing, not throw.
    verdicts: asked.filter((one) => one.startsWith("@")).map((one) => one.slice(1) as Verdict),
  };
};

/** Whether an assembled operation carries the alarm anywhere inside it. */
const alarming = (span: AssembledSpan): boolean =>
  span.verdict === "failed" ||
  span.events.some((one) => one.verdict === "failed") ||
  span.children.some(alarming);

/**
 * `stream` is `VITE_SEFER_STREAM`, which `src/app/env.ts` reads.
 *
 * Independently of what the stream is asked to print, a dev build prints
 * every `failed` as a `console.error` — the one alarm (see `Verdict`). It goes
 * through the same idle drain, so a failure costs the keystroke nothing, and
 * `stream({ alarms: false })` silences it for a session that is failing on
 * purpose.
 */
export const consoleStream = (stream = ""): ConsoleStream => {
  const backlog: { readonly head: string; readonly body: unknown; readonly loud: boolean }[] = [];
  const schedule = idle();
  let armed = false;
  // On from the start when the env asked; otherwise `stream()` turns it on at
  // runtime, which is the point — no restart to watch something.
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

  /** What the stream was asked for: names, then verdicts when any were named. */
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

/**
 * The last N assembled operations and the last N loose events.
 *
 * Two small rings of trees and strays, beside the event ring that holds far
 * more: rebuilding trees from the events on every read would be work done per
 * question instead of once per operation.
 */
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
    // Filtered NEWEST-first, then cut to `limit`: asking for the last ten
    // slow ones means ten slow ones, not "of the last ten, the slow ones".
    traces: (query) => {
      const asked: TraceQuery = typeof query === "number" ? { limit: query } : (query ?? {});
      const matched = operations.filter((span) => matchesQuery(span, asked));
      return take(matched, asked.limit);
    },
    logs: (limit) => take(loose, limit),
  };
};

/** `log` is `VITE_SEFER_LOG`, which `src/app/env.ts` reads; Node's `SEFER_LOG` also counts. */
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
