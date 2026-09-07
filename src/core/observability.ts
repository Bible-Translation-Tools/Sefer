import { Context, Effect, Layer, Logger, Tracer } from "effect";

export type Verdict =
  | "ready"
  | "passed"
  | "refused"
  | "rewrote"
  | "consumed"
  | "declined"
  | "failed";

export type EventKind = "span" | "note" | "log";

export type Level = "off" | "verdicts" | "spans" | "all";

export interface ObservabilityEvent {
  readonly seq: number;
  readonly t: number;
  readonly kind: EventKind;
  readonly name: string;
  readonly verdict?: Verdict;
  readonly detail?: string;
  readonly ms?: number;
  readonly self?: number;
  readonly correlation?: string;
}

export type ObservabilitySink = (event: ObservabilityEvent, line: string) => void;

export interface ObservabilityService {
  readonly span: (name: string, note?: string) => () => number;
  readonly note: (rule: string, verdict: Verdict, detail?: string, correlation?: string) => void;
  readonly recent: (limit?: number) => readonly ObservabilityEvent[];
  readonly export: () => string;
  readonly level: () => Level;
  readonly setLevel: (level: Level) => void;
  readonly dropped: () => number;
}

export interface ObservabilityOptions {
  readonly capacity?: number;
  readonly level?: Level;
  readonly sink?: ObservabilitySink | undefined;
}

export const DEFAULT_CAPACITY = 2000;

export const DEFAULT_LEVEL: Level = "all";

export const MAX_TEXT = 512;

const VOLUME: Readonly<Record<Level, number>> = { off: 0, verdicts: 1, spans: 2, all: 3 };

const round = (ms: number): number => Math.round(ms * 1000) / 1000;

const capped = (text: string): string => (text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT));

const messageText = (message: unknown): string => {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.map(messageText).join(" ");
  return String(message);
};

const toLine = (event: ObservabilityEvent): string => {
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
  if (event.correlation !== undefined) record.correlation = event.correlation;
  return JSON.stringify(record);
};

interface Ring extends ObservabilityService {
  readonly recordLog: (message: unknown, logLevel: string) => void;
  readonly recordEffectSpan: (span: Tracer.Span) => void;
}

const makeRing = (options: ObservabilityOptions): Ring => {
  const capacity = Math.max(1, Math.trunc(options.capacity ?? DEFAULT_CAPACITY));
  const sink = options.sink;
  const buffer = Array.from<ObservabilityEvent | undefined>({ length: capacity });
  const stack: number[] = [];
  let level: Level = options.level ?? DEFAULT_LEVEL;
  let at = 0;
  let count = 0;
  let seq = 0;
  let dropped = 0;

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
    if (sink === undefined) return;
    try {
      sink(recorded, `${toLine(recorded)}\n`);
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

  const span = (name: string, note?: string): (() => number) => {
    const started = performance.now();
    if (VOLUME[level] < VOLUME.spans) return () => round(performance.now() - started);
    const frame = stack.push(0) - 1;
    return () => {
      const ms = round(performance.now() - started);
      if (frame >= stack.length) return ms;
      const children = stack[frame] ?? 0;
      stack.length = frame;
      if (frame > 0) stack[frame - 1] = (stack[frame - 1] ?? 0) + ms;
      if (VOLUME[level] >= VOLUME.spans)
        push({ kind: "span", name, detail: note, ms, self: round(ms - children) });
      return ms;
    };
  };

  return {
    span,
    note: (rule, verdict, detail, correlation) => {
      if (VOLUME[level] < VOLUME.verdicts) return;
      push({ kind: "note", name: rule, verdict, detail, correlation });
    },
    recent,
    export: () => recent().reduce((text, event) => `${text}${toLine(event)}\n`, ""),
    level: () => level,
    setLevel: (next) => {
      level = next;
    },
    dropped: () => dropped,
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
      push({ kind: "span", name: finished.name, ms: round(ms), correlation: finished.traceId });
    },
  };
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
