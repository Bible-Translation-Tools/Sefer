import { Context, Effect, Layer, Logger, Tracer } from "effect";

export type Verdict =
  | "ready"
  | "passed"
  | "refused"
  | "rewrote"
  | "consumed"
  | "declined"
  | "failed";

export type EventKind = "operation" | "span" | "note" | "log";

export type Level = "off" | "verdicts" | "spans" | "all";

/**
 * The fields of a wide event.
 *
 * Primitives ONLY, and the type is the enforcement. An attribute holding a
 * reference — an `EditorState`, a `Book`, a decoded archive — would be pinned
 * alive by the ring for the next `capacity` events, which is how a bounded
 * buffer turns into a leak. Numbers also cost less than the sentences they
 * replace: a note that built `${id} r${before} -> r${after}` on every accepted
 * edit allocated a string per keystroke to say what four fields say.
 */
export type Attrs = Readonly<Record<AttrName, string | number | boolean>>;

/**
 * A field name on a wide event.
 *
 * A plain alias, not a branded type and not a constants module. The value of a
 * wide event is that adding a field costs nothing — the moment a new field
 * needs an enum entry, people stop adding them and go back to building
 * sentences, which is the habit this whole model removes. What the alias buys
 * is what a brand would have: every filterable field in the codebase is one
 * search for `AttrName`, with no casts at the call sites to pay for it.
 *
 * Convention, not enforcement: dotted namespaces, and the SHARED ones spelled
 * the same everywhere — `book.id`, `project.root`, `fs.path`, `fs.bytes`,
 * `op.trigger`, `op.link`. A `bookId` in one file and a `book.id` in another
 * makes an attribute filter quietly miss half its data.
 */
export type AttrName = string;

/**
 * Every operation the application can open.
 *
 * A union, unlike the fields: there are a dozen, they are structural, and a
 * typo in one is invisible — it does not fail, it just never matches a filter
 * again. Adding a name here is the deliberate act of saying a new kind of work
 * exists. See planning/01-discussing/event-inventory-2026-09-16.md.
 */
export type OperationName =
  | "boot"
  | "project.open"
  | "project.close"
  | "project.watch"
  | "editor.mutation"
  | "editor.selection"
  | "editor.render"
  | "save"
  | "file.changed"
  | "analysis.pass"
  | "analysis.warm"
  | "journal.write"
  | "journal.pending"
  | "journal.restore"
  | "journal.offer"
  | "import.resource"
  /**
   * One command run from the palette, a keybinding or a click. The id is in
   * the name so a trace list reads as what the person did, and `command.` is a
   * prefix a filter can take whole.
   */
  | `command.${string}`;

/**
 * One record in the ring.
 *
 * `trace` is the OPERATION — one end-to-end piece of work, which is to say one
 * thing the user did. It is not a book id and not a file: those are attributes
 * OF the work. `id` and `parent` are this record's own span identity, so the
 * events of one operation reassemble into a tree rather than a pile.
 */
export interface ObservabilityEvent {
  readonly seq: number;
  readonly t: number;
  readonly kind: EventKind;
  readonly name: string;
  readonly verdict?: Verdict;
  readonly detail?: string;
  readonly ms?: number;
  readonly self?: number;
  /** 32 hex: the operation every event of one gesture shares. */
  readonly trace?: string;
  /** 16 hex: this record's own span, when it has one. */
  readonly id?: string;
  /** 16 hex: the span this one happened inside. */
  readonly parent?: string;
  readonly attrs?: Attrs;
}

export type ObservabilitySink = (event: ObservabilityEvent, line: string) => void;

/**
 * What every event of a session has in common, stamped ONCE.
 *
 * The static half of the context — build, host, session — belongs on the OTLP
 * Resource and on one JSONL header record, not repeated on every line. What
 * varies goes in `attrs`; what cannot vary lives here.
 */
export interface SessionInfo {
  readonly id: string;
  readonly build?: string;
  readonly host?: string;
  readonly started: number;
}

/**
 * The narrating end of one operation.
 *
 * It IS an `ObservabilityService`, which is the whole trick: core asks the
 * context for `Observability` and cannot tell whether it received the root or
 * a gesture's own. So the gesture door provides this one for the duration of
 * the work — `Effect.provideService(Observability, op)` — and every `note()`
 * and `span()` underneath lands in the right operation across every await,
 * with no core signature growing a parameter and no core module learning that
 * tracing exists.
 */
export interface Operation extends ObservabilityService {
  readonly trace: string;
  readonly id: string;
  /** Add fields to the wide event, any time before it ends. */
  readonly attr: (attrs: Attrs) => void;
  /**
   * What the work turned out to be, when that is only known once it is done —
   * an editor transaction is a mutation or a selection move depending on what
   * the rules did to it, and the wide record is written at the end anyway.
   */
  readonly rename: (name: OperationName) => void;
  /**
   * Writes the one wide record. Returns its duration in milliseconds.
   *
   * `ms` overrides the measured wall time for a caller that knows better: an
   * instrument whose trace is closed lazily would otherwise report the idle
   * time until the next gesture as the duration of this one.
   */
  readonly end: (verdict?: Verdict, attrs?: Attrs, ms?: number) => number;
}

export interface ObservabilityService {
  /**
   * Open an operation: one user-initiated piece of work, or one piece of
   * background work that no gesture caused.
   *
   * `cause` is the trace of the work this one FOLLOWED FROM, when that work has
   * already finished — a debounced journal write, an analysis pass serving
   * several keystrokes. It is not a parent: a parent would have to pick one of
   * those keystrokes and be wrong about the rest, and the gesture's own record
   * could never be written while it waited. `op.cause` carries it as a field,
   * so one query returns the whole cascade.
   */
  readonly operation: (
    name: OperationName,
    attrs?: Attrs,
    options?: { readonly cause?: string | undefined },
  ) => Operation;
  readonly span: (name: string, note?: string, attrs?: Attrs) => (attrs?: Attrs) => number;
  readonly note: (rule: string, verdict: Verdict, detail?: string, attrs?: Attrs) => void;
  readonly recent: (limit?: number) => readonly ObservabilityEvent[];
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

export const DEFAULT_CAPACITY = 2000;

export const DEFAULT_LEVEL: Level = "all";

export const MAX_TEXT = 512;

/**
 * Fields per event. High cardinality is the point — wide events are how a
 * question gets answered without a second run — but the ring holds `capacity`
 * of them in a browser tab, so width is bounded rather than trusted.
 */
export const MAX_ATTRS = 32;

const VOLUME: Readonly<Record<Level, number>> = { off: 0, verdicts: 1, spans: 2, all: 3 };

const round = (ms: number): number => Math.round(ms * 1000) / 1000;

const capped = (text: string): string => (text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT));

const messageText = (message: unknown): string => {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.map(messageText).join(" ");
  return String(message);
};

/**
 * Random ids in OTLP's shape: 16 bytes for a trace, 8 for a span.
 *
 * `crypto.getRandomValues` where there is one — it is in browsers and in Node,
 * and unlike `crypto.randomUUID` it is not gated to secure contexts, so a dev
 * server reached over the LAN still mints ids. `Math.random` otherwise: these
 * name a local trace, they do not defend anything.
 */
const entropy = (bytes: number): Uint8Array => {
  const out = new Uint8Array(bytes);
  // SAFETY: `crypto` is a global in browsers and in Node, but core compiles
  // without either lib, so the shape is narrowed to the one method used and
  // checked at runtime before it is called.
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

/** Bounded, primitives only, strings capped — see `Attrs`. */
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
  if (event.trace !== undefined) record.trace = event.trace;
  if (event.id !== undefined) record.id = event.id;
  if (event.parent !== undefined) record.parent = event.parent;
  if (event.attrs !== undefined) record.attrs = event.attrs;
  return JSON.stringify(record);
};

/** Where an event sits: the operation it belongs to, and the span above it. */
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

  /**
   * The span half, bound to a frame.
   *
   * The `stack` is about SELF time, not parentage: a span subtracts whatever
   * nested inside it synchronously. Parentage comes from the frame — which is
   * to say from whoever was handed this service — because that is the one
   * thing that stays true across an await.
   */
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

  /**
   * One wide event, written ONCE when the work ends.
   *
   * Not at the start and not in pieces: the record carries everything known by
   * the time the operation finished, which is the point of a wide event and
   * the reason it can answer a question nobody thought to ask at the start.
   * Children are written as they happen, so a JSONL reader sees the parent
   * last — the same order a collector receives it in.
   */
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
      // The cause is a field like any other: the work this one followed from,
      // rather than the work it runs inside.
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
      export: () => recent().reduce((text, event) => `${text}${toLine(event)}\n`, ""),
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

/**
 * One finished piece of work, as a tree.
 *
 * The ring is a FLAT stream — the wide record last, children before it — which
 * is what a bounded buffer and a JSONL line want. Every reader of it wants the
 * opposite: the operation with its work inside. So the assembly happens ONCE,
 * here, and the OTLP exporter, the console and the dev surface all render the
 * same object rather than each rebuilding it from `trace`/`id`/`parent`.
 */
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
  /** What happened inside, in order: no duration of its own, a point in time. */
  readonly events: readonly AssembledEvent[];
  readonly children: readonly AssembledSpan[];
}

export interface AssemblerSinks {
  /** A whole operation, once its wide record arrives. */
  readonly operation: (span: AssembledSpan) => void;
  /**
   * An event belonging to no operation: boot, a filesystem watcher, an Effect
   * log from an unscoped fiber. Passed straight through — there is nothing to
   * wait for and nothing to nest it under.
   */
  readonly loose: (event: ObservabilityEvent) => void;
}

export interface AssemblerOptions {
  /** Operations held open at once. Oldest is dropped, not grown. */
  readonly maxTraces?: number;
  /** Events held for one operation. Further ones are dropped, not grown. */
  readonly maxEvents?: number;
}

export const DEFAULT_MAX_TRACES = 64;

export const DEFAULT_MAX_EVENTS = 256;

/**
 * Feed it the ring's events; it calls `operation` when one completes.
 *
 * An operation that never ends is never emitted — the editor closes a
 * transaction when the next one opens, so one is always outstanding — which is
 * why the hold is bounded and drops oldest-first rather than waiting.
 */
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
    // Depth is two by construction: a span parents to the frame it was opened
    // on, which is the operation, so everything held is directly under it. If
    // that ever stops being true this flattens rather than drops.
    //
    // A note or a log inside an operation is a point in time, not a duration:
    // a span EVENT. Only a span is a span.
    const events: AssembledEvent[] = [];
    const children: AssembledSpan[] = [];
    for (const one of inside) {
      if (one.kind === "span") children.push(spanOf(one, [], []));
      else events.push(eventOf(one));
    }
    sinks.operation(spanOf(event, events, children));
  };
};

/**
 * What to show. Values only, deliberately — no predicates and no nesting.
 *
 * `slowerThan` is the one piece of sugar, because "which of these was slow" is
 * the question that gets asked constantly and is tedious to express any other
 * way. It compares the OPERATION's own duration, not its children's.
 */
export interface TraceQuery {
  readonly limit?: number;
  /** Name prefix — the same matcher the console stream filters on. */
  readonly name?: string;
  /**
   * Name prefixes to leave out. Applied after `name`, so "everything except
   * caret moves" is one word rather than a list of everything else.
   */
  readonly exclude?: readonly string[];
  /** Every entry must match the operation's own fields. */
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

/**
 * One operation as a person reads it.
 *
 * Lives in core beside the shape it renders, so the console, a dev surface and
 * anything later (a panel, a picture-in-picture window) print the same thing
 * rather than each inventing a layout.
 */
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
