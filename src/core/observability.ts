import { Context, Effect, Layer, Logger, Tracer } from "effect";

export type Verdict =
  | "ready"
  | "passed"
  | "refused"
  | "rewrote"
  | "consumed"
  | "declined"
  | "unavailable"
  | "failed";

const HELD_VERDICTS: ReadonlySet<Verdict> = new Set<Verdict>(["failed", "unavailable", "refused"]);

export type EventKind = "operation" | "span" | "note" | "log";

export type Level = "off" | "verdicts" | "spans" | "all";

export type Attrs = Readonly<Record<AttrName, string | number | boolean>>;

export type AttrName = string;

export type OperationName =
  | "boot"
  | "project.open"
  | "project.close"
  | "editor.mutation"
  | "editor.selection"
  | "editor.render"
  | "save"
  | "analysis.pass"
  | "analysis.warm"
  | "journal.write"
  | "journal.restore"
  | "journal.discard"
  | "journal.offer"
  | "import.resource"
  | "import.remote"
  | "catalogue.browse"
  | "find.run"
  | "find.retake"
  | "findings.navigate"
  | "reference.load"
  | "review.compare"
  | `review.diff.${string}`
  | "sync.survey"
  | "sync.plan"
  | "sync.transfer"
  | "sync.check"
  | "upstream.check"
  | "migrate.open"
  | "migrate.assemble"
  | "history.deepen"
  | "terms.load"
  | "terms.select"
  | "inventory.load"
  | "update.check"
  | "update.install"
  | "diagnostics.export"
  | `command.${string}`
  | `playground.${string}`
  | `history.${string}`;

export interface ObservabilityEvent {
  readonly seq: number;
  readonly t: number;
  readonly kind: EventKind;
  readonly name: string;
  readonly verdict?: Verdict;
  readonly detail?: string;
  readonly ms?: number;
  readonly self?: number;
  readonly trace?: string;
  readonly id?: string;
  readonly parent?: string;
  readonly attrs?: Attrs;
}

export type ObservabilitySink = (event: ObservabilityEvent) => void;

export interface SessionInfo {
  readonly id: string;
  readonly build?: string;
  readonly host?: string;
  readonly started: number;
}

export interface Operation extends ObservabilityService {
  readonly trace: string;
  readonly id: string;
  readonly attr: (attrs: Attrs) => void;
  readonly rename: (name: OperationName) => void;
  readonly end: (verdict?: Verdict, attrs?: Attrs, ms?: number) => number;
}

export interface ObservabilityService {
  readonly operation: (
    name: OperationName,
    attrs?: Attrs,
    options?: { readonly cause?: string | undefined },
  ) => Operation;
  readonly span: (name: string, note?: string, attrs?: Attrs) => (attrs?: Attrs) => number;
  readonly note: (rule: string, verdict: Verdict, detail?: string, attrs?: Attrs) => void;
  readonly recent: (limit?: number) => readonly ObservabilityEvent[];
  readonly failures: (limit?: number) => readonly ObservabilityEvent[];
  readonly export: () => string;
  readonly level: () => Level;
  readonly setLevel: (level: Level) => void;
  readonly dropped: () => number;
  readonly session: () => SessionInfo;
}

export interface ObservabilityOptions {
  readonly capacity?: number;
  readonly level?: Level;
  readonly sink?: ObservabilitySink | undefined;
  readonly build?: string | undefined;
  readonly host?: string | undefined;
}

const DEFAULT_CAPACITY = 2000;

const FAILURE_CAPACITY = 200;

const DEFAULT_LEVEL: Level = "all";

export const MAX_TEXT = 512;

const MAX_ATTRS = 32;

const VOLUME: Readonly<Record<Level, number>> = { off: 0, verdicts: 1, spans: 2, all: 3 };

const round = (ms: number): number => Math.round(ms * 1000) / 1000;

const capped = (text: string): string => (text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT));

const messageText = (message: unknown): string => {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.map(messageText).join(" ");
  return String(message);
};

// `crypto.randomUUID` is gated to secure contexts, `crypto.getRandomValues` is not.
const entropy = (bytes: number): Uint8Array => {
  const out = new Uint8Array(bytes);
  // SAFETY: `crypto` is a global in browsers and in Node, but core compiles without either lib, so the shape is narrowed to the one method used and checked at runtime before it is called.
  const source = (
    globalThis as {
      crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (typeof source?.getRandomValues === "function") return source.getRandomValues(out);
  for (let index = 0; index < bytes; index += 1) out[index] = Math.floor(Math.random() * 256);
  return out;
};

const hex = (bytes: number): string =>
  Array.from(entropy(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const traceId = (): string => hex(16);

const spanId = (): string => hex(8);

const narrow = (attrs: Attrs | undefined): Attrs | undefined => {
  if (attrs === undefined) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let width = 0;
  for (const [key, value] of Object.entries(attrs)) {
    if (width >= MAX_ATTRS) break;
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? capped(value) : value;
    width += 1;
  }
  return width === 0 ? undefined : out;
};

const merge = (into: Attrs | undefined, from: Attrs | undefined): Attrs | undefined => {
  if (into === undefined) return narrow(from);
  if (from === undefined) return into;
  return narrow({ ...into, ...from });
};

export const eventLine = (event: ObservabilityEvent): string => {
  const record: Record<string, unknown> = {
    seq: event.seq,
    t: event.t,
    kind: event.kind,
    name: event.name,
  };
  if (event.verdict !== undefined) record.verdict = event.verdict;
  if (event.detail !== undefined) record.detail = event.detail;
  if (event.ms !== undefined) record.ms = event.ms;
  if (event.self !== undefined) record.self = event.self;
  if (event.trace !== undefined) record.trace = event.trace;
  if (event.id !== undefined) record.id = event.id;
  if (event.parent !== undefined) record.parent = event.parent;
  if (event.attrs !== undefined) record.attrs = event.attrs;
  return JSON.stringify(record);
};

interface Frame {
  readonly trace: string;
  readonly parent: string;
}

interface Ring extends ObservabilityService {
  readonly recordLog: (message: unknown, logLevel: string) => void;
  readonly recordEffectSpan: (span: Tracer.Span) => void;
}

const makeRing = (options: ObservabilityOptions): Ring => {
  const capacity = Math.max(1, Math.trunc(options.capacity ?? DEFAULT_CAPACITY));
  const sink = options.sink;
  const buffer = Array.from<ObservabilityEvent | undefined>({ length: capacity });
  const stack: number[] = [];
  const info: SessionInfo = {
    id: hex(8),
    ...(options.build === undefined ? {} : { build: options.build }),
    ...(options.host === undefined ? {} : { host: options.host }),
    started: Date.now(),
  };
  let level: Level = options.level ?? DEFAULT_LEVEL;
  let at = 0;
  let count = 0;
  let seq = 0;
  let dropped = 0;
  const held: ObservabilityEvent[] = [];

  const push = (event: Omit<ObservabilityEvent, "seq" | "t">): void => {
    const recorded: ObservabilityEvent = {
      seq: seq++,
      t: Date.now(),
      ...event,
      name: capped(event.name),
      ...(event.detail === undefined ? {} : { detail: capped(event.detail) }),
    };
    buffer[at] = recorded;
    at = (at + 1) % capacity;
    if (count < capacity) count += 1;
    if (recorded.verdict !== undefined && HELD_VERDICTS.has(recorded.verdict)) {
      held.push(recorded);
      if (held.length > FAILURE_CAPACITY) held.shift();
    }
    if (sink === undefined) return;
    try {
      sink(recorded);
    } catch {
      dropped += 1;
    }
  };

  const recent = (limit?: number): readonly ObservabilityEvent[] => {
    const take = limit === undefined ? count : Math.max(0, Math.min(Math.trunc(limit), count));
    const start = (at - take + capacity) % capacity;
    const out: ObservabilityEvent[] = [];
    for (let index = 0; index < take; index += 1) {
      const event = buffer[(start + index) % capacity];
      if (event !== undefined) out.push(event);
    }
    return out;
  };

  const spanIn =
    (frame: Frame | undefined) =>
    (name: string, note?: string, attrs?: Attrs): ((extra?: Attrs) => number) => {
      const started = performance.now();
      if (VOLUME[level] < VOLUME.spans) return () => round(performance.now() - started);
      const depth = stack.push(0) - 1;
      const own = spanId();
      const opened = narrow(attrs);
      return (extra?: Attrs) => {
        const ms = round(performance.now() - started);
        if (depth >= stack.length) return ms;
        const children = stack[depth] ?? 0;
        stack.length = depth;
        if (depth > 0) stack[depth - 1] = (stack[depth - 1] ?? 0) + ms;
        const fields = merge(opened, extra);
        if (VOLUME[level] >= VOLUME.spans)
          push({
            kind: "span",
            name,
            detail: note,
            ms,
            self: round(ms - children),
            id: own,
            ...(frame === undefined ? {} : { trace: frame.trace, parent: frame.parent }),
            ...(fields === undefined ? {} : { attrs: fields }),
          });
        return ms;
      };
    };

  const noteIn =
    (frame: Frame | undefined) =>
    (rule: string, verdict: Verdict, detail?: string, attrs?: Attrs): void => {
      if (VOLUME[level] < VOLUME.verdicts) return;
      const fields = narrow(attrs);
      push({
        kind: "note",
        name: rule,
        verdict,
        detail,
        ...(frame === undefined ? {} : { trace: frame.trace, parent: frame.parent }),
        ...(fields === undefined ? {} : { attrs: fields }),
      });
    };

  const operationIn =
    (frame: Frame | undefined) =>
    (
      name: OperationName,
      attrs?: Attrs,
      options?: { readonly cause?: string | undefined },
    ): Operation => {
      const trace = frame?.trace ?? traceId();
      const own = spanId();
      const started = performance.now();
      let fields = merge(
        narrow(attrs),
        options?.cause === undefined ? undefined : { "op.cause": options.cause },
      );
      let ended = false;
      let title = name;

      return {
        ...make({ trace, parent: own }),
        trace,
        id: own,
        attr: (extra) => {
          fields = merge(fields, extra);
        },
        rename: (next) => {
          title = next;
        },
        end: (verdict, extra, measured) => {
          const ms = measured ?? round(performance.now() - started);
          if (ended || VOLUME[level] < VOLUME.verdicts) return ms;
          ended = true;
          const all = merge(fields, extra);
          push({
            kind: "operation",
            name: title,
            ...(verdict === undefined ? {} : { verdict }),
            ms,
            trace,
            id: own,
            ...(frame === undefined ? {} : { parent: frame.parent }),
            ...(all === undefined ? {} : { attrs: all }),
          });
          return ms;
        },
      };
    };

  function make(frame: Frame | undefined): ObservabilityService {
    return {
      operation: operationIn(frame),
      span: spanIn(frame),
      note: noteIn(frame),
      recent,
      failures: (limit) =>
        limit === undefined ? [...held] : held.slice(Math.max(0, held.length - Math.trunc(limit))),
      export: () => recent().reduce((text, event) => `${text}${eventLine(event)}\n`, ""),
      level: () => level,
      setLevel: (next) => {
        level = next;
      },
      dropped: () => dropped,
      session: () => info,
    };
  }

  const root = make(undefined);

  return {
    ...root,
    recordLog: (message, logLevel) => {
      if (VOLUME[level] < VOLUME.verdicts) return;
      push({
        kind: "log",
        name: messageText(message),
        verdict: logLevel === "Error" || logLevel === "Fatal" ? "failed" : undefined,
        detail: logLevel,
      });
    },
    recordEffectSpan: (finished) => {
      if (VOLUME[level] < VOLUME.all) return;
      const status = finished.status;
      const ms = status._tag === "Ended" ? Number(status.endTime - status.startTime) / 1e6 : 0;
      push({
        kind: "span",
        name: finished.name,
        ms: round(ms),
        trace: finished.traceId,
        id: finished.spanId,
      });
    },
  };
};

export interface AssembledEvent {
  readonly t: number;
  readonly name: string;
  readonly verdict?: Verdict;
  readonly detail?: string;
  readonly attrs?: Attrs;
}

export interface AssembledSpan {
  readonly name: string;
  readonly trace: string;
  readonly id: string;
  readonly t: number;
  readonly ms?: number;
  readonly self?: number;
  readonly verdict?: Verdict;
  readonly attrs?: Attrs;
  readonly events: readonly AssembledEvent[];
  readonly children: readonly AssembledSpan[];
}

export interface AssemblerSinks {
  readonly operation: (span: AssembledSpan) => void;
  readonly loose: (event: ObservabilityEvent) => void;
}

export interface AssemblerOptions {
  readonly maxTraces?: number;
  readonly maxEvents?: number;
}

const DEFAULT_MAX_TRACES = 64;

const DEFAULT_MAX_EVENTS = 256;

export const makeAssembler = (
  sinks: AssemblerSinks,
  options: AssemblerOptions = {},
): ((event: ObservabilityEvent) => void) => {
  const maxTraces = Math.max(1, Math.trunc(options.maxTraces ?? DEFAULT_MAX_TRACES));
  const maxEvents = Math.max(1, Math.trunc(options.maxEvents ?? DEFAULT_MAX_EVENTS));
  const held = new Map<string, ObservabilityEvent[]>();

  const hold = (trace: string, event: ObservabilityEvent): void => {
    const open = held.get(trace);
    if (open === undefined) {
      if (held.size >= maxTraces) {
        const oldest = held.keys().next();
        if (!oldest.done) held.delete(oldest.value);
      }
      held.set(trace, [event]);
      return;
    }
    if (open.length >= maxEvents) return;
    open.push(event);
  };

  const spanOf = (
    event: ObservabilityEvent,
    events: readonly AssembledEvent[],
    children: readonly AssembledSpan[],
  ): AssembledSpan => ({
    name: event.name,
    trace: event.trace ?? "",
    id: event.id ?? "",
    t: event.t,
    ...(event.ms === undefined ? {} : { ms: event.ms }),
    ...(event.self === undefined ? {} : { self: event.self }),
    ...(event.verdict === undefined ? {} : { verdict: event.verdict }),
    ...(event.attrs === undefined ? {} : { attrs: event.attrs }),
    events,
    children,
  });

  const eventOf = (event: ObservabilityEvent): AssembledEvent => ({
    t: event.t,
    name: event.name,
    ...(event.verdict === undefined ? {} : { verdict: event.verdict }),
    ...(event.detail === undefined ? {} : { detail: event.detail }),
    ...(event.attrs === undefined ? {} : { attrs: event.attrs }),
  });

  return (event) => {
    const trace = event.trace;
    if (trace === undefined) {
      sinks.loose(event);
      return;
    }
    if (event.kind !== "operation") {
      hold(trace, event);
      return;
    }
    const inside = held.get(trace) ?? [];
    held.delete(trace);
    const events: AssembledEvent[] = [];
    const children: AssembledSpan[] = [];
    for (const one of inside) {
      if (one.kind === "span") children.push(spanOf(one, [], []));
      else events.push(eventOf(one));
    }
    sinks.operation(spanOf(event, events, children));
  };
};

export interface TraceQuery {
  readonly limit?: number;
  readonly name?: string;
  readonly exclude?: readonly string[];
  readonly where?: Readonly<Record<AttrName, string | number | boolean>>;
  readonly slowerThan?: number;
}

export const matchesQuery = (span: AssembledSpan, query: TraceQuery): boolean => {
  if (query.name !== undefined && !span.name.startsWith(query.name)) return false;
  if (query.exclude?.some((prefix) => span.name.startsWith(prefix)) === true) return false;
  if (query.slowerThan !== undefined && (span.ms ?? 0) <= query.slowerThan) return false;
  if (query.where === undefined) return true;
  for (const [key, value] of Object.entries(query.where))
    if (span.attrs?.[key] !== value) return false;
  return true;
};

const fields = (attrs: Attrs | undefined): string =>
  attrs === undefined
    ? ""
    : Object.entries(attrs)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ");

export const printSpan = (span: AssembledSpan, indent = ""): string => {
  const ms = span.ms === undefined ? "" : ` ${span.ms}ms`;
  const verdict = span.verdict === undefined ? "" : ` ${span.verdict}`;
  const head = `${indent}${span.name}${ms}${verdict}`;
  const shown = fields(span.attrs);
  const lines = [shown === "" ? head : `${head}  ${shown}`];
  for (const one of span.events) {
    const said = one.detail === undefined ? "" : ` — ${one.detail}`;
    const on = fields(one.attrs);
    const verdictOf =
      one.verdict === undefined || one.verdict === "passed" ? "" : ` ${one.verdict}`;
    lines.push(`${indent}  · ${one.name}${verdictOf}${said}${on === "" ? "" : `  ${on}`}`);
  }
  for (const one of span.children) lines.push(printSpan(one, `${indent}  `));
  return lines.join("\n");
};

export class Observability extends Context.Service<Observability, ObservabilityService>()(
  "Observability",
) {}

const ringLogger = (ring: Ring): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    ring.recordLog(options.message, options.logLevel);
  });

const ringTracer = (ring: Ring): Tracer.Tracer =>
  Tracer.make({
    span(options) {
      const created = new Tracer.NativeSpan(options);
      const finish = created.end.bind(created);
      created.end = (endTime, exit) => {
        finish(endTime, exit);
        ring.recordEffectSpan(created);
      };
      return created;
    },
  });

export const ObservabilityLive = (options: ObservabilityOptions = {}): Layer.Layer<Observability> =>
  Layer.unwrap(
    Effect.sync(() => {
      const ring = makeRing(options);
      return Layer.mergeAll(
        Layer.succeed(Observability, ring),
        Logger.layer([ringLogger(ring)]),
        Layer.succeed(Tracer.Tracer, ringTracer(ring)),
      );
    }),
  );
