/**
 * ONE instrument for the whole editor pipeline: per transaction, every stage a
 * keystroke flowed through and what each stage decided.
 *
 * Why this file exists. The editor's decisions are spread across two
 * CodeMirror hooks that run in opposite directions (`changeFilter`,
 * `transactionFilter`), a keymap, and a handful of derived products
 * (scan/index/paint/decorate). Before this, each of them noted a verdict on
 * its own and a reader had to reassemble the order by eye. A `Trace` is that
 * reassembly done once, at the only place that can do it cheaply: the frame
 * that opens around each rule.
 *
 * The shape:
 *
 *   - `tracer` is a Facet, not a module global, because two states (a book and
 *     a window over it) trace separately, and because a test wants the ring
 *     while the app wants the Observability bridge.
 *   - `Tracer.begin(state, origin)` opens one `Trace` per transaction. The
 *     trace is keyed on the *start* state's identity: a command reads that
 *     state, then the filters run against it, so a whole gesture — command,
 *     admission, normalization, protection, settlement — lands in one trace
 *     with one correlation id.
 *   - `Trace.stage()` / `Trace.command()` open a frame and return its closer.
 *     A rule's own `note`/`noteTr` call, made INSIDE an open frame, becomes
 *     that frame's verdict — so the rules keep the words they already had and
 *     nothing is recorded twice.
 *   - `makeTracer(emit)` is the single implementation. The pluggable half is
 *     emission: `null` fills only the local ring, `sinkTracer` feeds the
 *     legacy `TraceSink` (harness, `ringSink`), `observabilityTracer`
 *     (src/editor/observability.ts) writes Sefer's ring.
 *
 * The cost when nobody is watching: `tracing(state)` is one facet read and
 * every call site guards on it. When the facet is null NOTHING is allocated.
 */

import { EditorState, Facet, type Transaction } from "@codemirror/state";

import { onDerived } from "./timing";

/** The spike's vocabulary, unchanged: what a rule decided about a keystroke. */
export type Verdict = "refused" | "rewrote" | "moved" | "consumed" | "declined" | "passed";

/** What a rule says about itself, in its own words. */
export interface TraceStep {
  rule: string;
  verdict: Verdict;
  detail?: string;
}

/**
 * Where an entry came from:
 *  - `stage`    — a phase rule wrapped by `compose.install`
 *  - `command`  — a keymap binding (or a movement settle)
 *  - `step`     — a `note` made outside any frame
 *  - `derive`   — a local span from `core/timing.ts` (scan, index, paint,
 *                 decorate): the derivation pipeline, not a decision
 */
export type EntryKind = "stage" | "command" | "step" | "derive";

export type FrameKind = "stage" | "command";

/** One closed frame. `ms` is wall time inside the frame, children included. */
export interface TraceEntry {
  readonly kind: EntryKind;
  /** The phase for a stage ("admission" …); "" for everything else. */
  readonly phase: string;
  readonly name: string;
  readonly verdict: Verdict;
  readonly detail?: string;
  readonly ms: number;
  /** A monotonic step counter, so entries from several traces still order. */
  readonly at: number;
}

/**
 * One transaction's flow through the pipeline. Mutated as the transaction
 * proceeds and handed to the emitter as it goes, so a reader sees the stages
 * in order rather than a summary after the fact.
 */
export interface TraceSummary {
  /** This trace's number; the emitter pairs it with the book id. */
  readonly seq: number;
  /** CodeMirror's `userEvent`, or how the trace was opened. */
  readonly origin: string;
  readonly docLength: number;
  readonly head: number;
  readonly entries: readonly TraceEntry[];
  /** The FIRST stage that refused — the one a `Refusal` should name. */
  readonly refusedBy: string | null;
  readonly ms: number;
}

/** The closer a frame hands back. Ignored if the rule noted its own verdict. */
export type CloseFrame = (verdict: Verdict, detail?: string) => void;

export interface Trace {
  readonly seq: number;
  /** Opens the frame around one phase rule. */
  stage(phase: string, name: string): CloseFrame;
  /** Opens the frame around one command invocation. */
  command(name: string): CloseFrame;
  /** A rule's own verdict. Inside an open frame it BECOMES the frame's. */
  step(step: TraceStep): void;
  /** A closed local span from `core/timing.ts`: the derivation pipeline. */
  derived(name: string, detail: string, ms: number): void;
  /**
   * Closes the trace. Called for you when the next transaction begins, so no
   * rule has to remember to. The outcome is not an argument because it is
   * already known: `refusedBy`, else the entries' own verdicts.
   */
  end(): void;
}

export interface Tracer {
  /**
   * One trace per transaction. `state` is the transaction's START state (the
   * one a command read), which is also the trace's key.
   */
  begin(state: EditorState, origin: string): Trace;
}

/**
 * How a trace reaches the outside world. A factory per trace, so per-trace
 * state (the level read once, "have I written the one note yet") has somewhere
 * to live without a map.
 */
export type Emitter = (trace: TraceSummary) => TraceEmit;

export interface TraceEmit {
  /**
   * Called when a frame OPENS, and returns the recorder for its closed entry.
   * Opening early is what lets an emitter wrap the frame in a real span.
   */
  readonly frame: (kind: FrameKind, phase: string, name: string) => (entry: TraceEntry) => void;
  /** An entry with no frame of its own: a bare `note`, or a derived span. */
  readonly step: (entry: TraceEntry) => void;
  readonly end: () => void;
}

export const tracer = Facet.define<Tracer, Tracer | null>({ combine: (v) => v[0] ?? null });

/** The one guard every call site uses. One facet read, no allocation. */
export const tracing = (state: EditorState): boolean => state.facet(tracer) !== null;

const RING = 64;
const ring: TraceSummary[] = [];

let seq = 0;
let steps = 0;

/**
 * The first refusal since `clearRefusal()`, for `Refusal.rule`.
 *
 * A module slot rather than a lookup on the trace, because `editorBook.apply`
 * asks the question across a dispatch it does not own the trace of, and
 * because it must work whichever tracer is installed.
 */
let refusal: { rule: string; detail?: string } | null = null;

export const clearRefusal = (): void => {
  refusal = null;
};

export const lastRefusal = (): { rule: string; detail?: string } | null => refusal;

interface Live {
  seq: number;
  origin: string;
  docLength: number;
  head: number;
  entries: TraceEntry[];
  refusedBy: string | null;
  ms: number;
}

interface Frame {
  kind: FrameKind;
  phase: string;
  name: string;
  verdict: Verdict | null;
  detail: string | undefined;
  started: number;
  record: (entry: TraceEntry) => void;
  under: Frame | null;
}

const NO_EMIT: TraceEmit = {
  frame: () => () => {},
  step: () => {},
  end: () => {},
};

/**
 * The single `Trace` implementation. Everything about ordering, timing, the
 * ring and the refusal slot is here exactly once; `emit` is the only variable.
 */
export const makeTracer = (emit: Emitter | null): Tracer => ({
  begin: (state, origin) => {
    const live: Live = {
      seq: ++seq,
      origin,
      docLength: state.doc.length,
      head: state.selection.main.head,
      entries: [],
      refusedBy: null,
      ms: 0,
    };
    const opened = performance.now();
    const out = emit === null ? NO_EMIT : emit(live);
    let open: Frame | null = null;
    let closed = false;

    const push = (
      kind: EntryKind,
      phase: string,
      name: string,
      verdict: Verdict,
      detail: string | undefined,
      ms: number,
      record: ((entry: TraceEntry) => void) | null,
    ): void => {
      const entry: TraceEntry = { kind, phase, name, verdict, detail, ms, at: ++steps };
      live.entries.push(entry);
      if (verdict === "refused" && live.refusedBy === null) {
        live.refusedBy = name;
        if (refusal === null) refusal = { rule: name, detail };
      }
      if (record === null) out.step(entry);
      else record(entry);
    };

    const frame = (kind: FrameKind, phase: string, name: string): CloseFrame => {
      const held: Frame = {
        kind,
        phase,
        name,
        verdict: null,
        detail: undefined,
        started: performance.now(),
        record: out.frame(kind, phase, name),
        under: open,
      };
      open = held;
      return (verdict, detail) => {
        // A rule that threw may leave a deeper frame open; unwinding to this
        // frame's parent is what keeps the stack honest either way.
        open = held.under;
        const said = held.verdict !== null;
        push(
          kind,
          phase,
          name,
          said ? (held.verdict ?? verdict) : verdict,
          said ? held.detail : detail,
          Math.round((performance.now() - held.started) * 1000) / 1000,
          held.record,
        );
      };
    };

    return {
      seq: live.seq,
      stage: (phase, name) => frame("stage", phase, name),
      command: (name) => frame("command", "", name),
      step: (s) => {
        const held = open;
        if (held !== null) {
          // Last word wins, except that `passed` never overwrites a decision:
          // a rule that says "guarding 3 ranges" then passes is still passing,
          // but a rule that refuses and then reports a detail stays refused.
          if (held.verdict === null || held.verdict === "passed" || s.verdict !== "passed") {
            held.verdict = s.verdict;
            held.detail = s.detail;
          }
          return;
        }
        push("step", "", s.rule, s.verdict, s.detail, 0, null);
      },
      derived: (name, detail, ms) => {
        push("derive", "", name, "passed", detail === "" ? undefined : detail, ms, null);
      },
      end: () => {
        if (closed) return;
        closed = true;
        live.ms = Math.round((performance.now() - opened) * 1000) / 1000;
        out.end();
        ring.push(live);
        if (ring.length > RING) ring.shift();
      },
    };
  },
});

/** Ring only: what `editorBook` installs when it has no Observability. */
export const localTracer: Tracer = makeTracer(null);

// The open trace, keyed on the state it began from. Transaction filtering is
// synchronous and single-threaded, so one slot is the whole bookkeeping: the
// same start state means the same gesture, a different one means the previous
// gesture is over.
let key: EditorState | null = null;
let current: Trace | null = null;

/** Ends the open trace, if any. Called for you; exported for a dev surface. */
export const flushTrace = (): void => {
  current?.end();
  current = null;
  key = null;
};

/**
 * The trace for this state's transaction — opening one if this is the first
 * stage of a new gesture, reusing it otherwise.
 *
 * Returns null when the facet is null, and allocates nothing in that case.
 */
export const traceFor = (state: EditorState, origin: string): Trace | null => {
  const held = state.facet(tracer);
  if (held === null) {
    if (current !== null) flushTrace();
    return null;
  }
  if (key === state && current !== null) return current;
  flushTrace();
  key = state;
  current = held.begin(state, origin);
  return current;
};

/** The last traces, newest last. Flushes the open one so the view is current. */
export const traces = (limit = RING): readonly TraceSummary[] => {
  flushTrace();
  return limit >= ring.length ? ring : ring.slice(ring.length - limit);
};

/** One trace as a person reads it: the stages in order, with their verdicts. */
export const dumpTrace = (t: TraceSummary): string =>
  [
    `trace #${t.seq} ${t.origin} doc=${t.docLength} head=${t.head} ${t.ms}ms` +
      (t.refusedBy === null ? "" : ` REFUSED by ${t.refusedBy}`),
    ...t.entries.map(
      (e) =>
        `  ${e.kind.padEnd(7)} ${(e.phase === "" ? e.name : `${e.phase}/${e.name}`).padEnd(46)} ` +
        `${e.verdict.padEnd(8)} ${String(e.ms).padStart(7)}  ${e.detail ?? ""}`,
    ),
  ].join("\n");

/**
 * A rule's own verdict, on whichever trace is open.
 *
 * `note` and `noteTr` keep the signatures the rules already call, so adopting
 * the tracer changed no rule's behaviour and no rule's words.
 */
export function note(state: EditorState, s: TraceStep, kind: "rule" | "press" = "rule"): void {
  traceFor(state, kind === "press" ? "press" : "state")?.step(s);
}

// `compose.install` names the origin when it opens the trace, so this
// fallback only matters for a `noteTr` that opens one on its own.
export function noteTr(tr: Transaction, s: TraceStep): void {
  traceFor(tr.startState, "transaction")?.step(s);
}

/**
 * The derivation pipeline joins the same trace: scan, index, paint, decorate.
 *
 * `core/timing.ts` cannot see an `EditorState`, so it calls back here and the
 * entry lands on whichever trace is open — which, on the keystroke path, is
 * the right one. Nothing is recorded when no trace is open.
 *
 * Two names are skipped because they are already accounted for: `keystroke`
 * belongs to the meter that owns the gesture, and `phase:<phase>` measures
 * exactly what the stage frame around that rule already measured.
 */
onDerived((name, detail, ms) => {
  if (name === "keystroke" || name.startsWith("phase:")) return;
  current?.derived(name, detail, ms);
});
