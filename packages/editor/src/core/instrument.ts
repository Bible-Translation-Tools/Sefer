import { EditorState, Facet, type Transaction } from "@codemirror/state";

import { onDerived } from "./timing";

/** The spike's vocabulary, unchanged: what a rule decided about a keystroke. */
export type TraceVerdict = "refused" | "rewrote" | "moved" | "consumed" | "declined" | "passed";

/** What a rule says about itself, in its own words. */
export interface TraceStep {
  rule: string;
  verdict: TraceVerdict;
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
  readonly verdict: TraceVerdict;
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
  /**
   * Whether this gesture changed the DOCUMENT, as opposed to only the
   * selection. Set as soon as a transaction that changes text joins the trace,
   * which may be after it opened: a command opens the trace on a keypress and
   * dispatches its transaction into the same one.
   */
  readonly changed: boolean;
  readonly docLength: number;
  readonly head: number;
  readonly entries: readonly TraceEntry[];
  /** The FIRST stage that refused — the one a `Refusal` should name. */
  readonly refusedBy: string | null;
  readonly ms: number;
}

/** The closer a frame hands back. Ignored if the rule noted its own verdict. */
export type CloseFrame = (verdict: TraceVerdict, detail?: string) => void;

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
  /** This gesture changed the document after all. Idempotent. */
  mutated(): void;
  /**
   * Fields for the gesture's own record — what the transaction turned out to
   * be, measured by code that runs after the phases have had their say.
   */
  annotate(fields: Readonly<Record<string, string | number | boolean>>): void;
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
  begin(state: EditorState, origin: string, changed?: boolean): Trace;
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
  /** Fields for the gesture's own record. See `Trace.annotate`. */
  readonly annotate: (fields: Readonly<Record<string, string | number | boolean>>) => void;
  readonly end: () => void;
}

export const tracer = Facet.define<Tracer, Tracer | null>({ combine: (v) => v[0] ?? null });

/** The one guard every call site uses. One facet read, no allocation. */
export const tracing = (state: EditorState): boolean => state.facet(tracer) !== null;

let seq = 0;
let steps = 0;

let refusal: { rule: string; detail?: string } | null = null;

export const clearRefusal = (): void => {
  refusal = null;
};

export const lastRefusal = (): { rule: string; detail?: string } | null => refusal;

interface Live {
  seq: number;
  origin: string;
  changed: boolean;
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
  verdict: TraceVerdict | null;
  detail: string | undefined;
  started: number;
  record: (entry: TraceEntry) => void;
  under: Frame | null;
}

const NO_EMIT: TraceEmit = {
  frame: () => () => {},
  step: () => {},
  annotate: () => {},
  end: () => {},
};

/**
 * The single `Trace` implementation. Everything about ordering, timing and
 * the refusal slot is here exactly once; `emit` is the only variable.
 */
export const makeTracer = (emit: Emitter | null): Tracer => ({
  begin: (state, origin, changed = false) => {
    const live: Live = {
      seq: ++seq,
      origin,
      changed,
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
      verdict: TraceVerdict,
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
      mutated: () => {
        live.changed = true;
      },
      annotate: (fields) => {
        out.annotate(fields);
      },
      step: (s) => {
        const held = open;
        if (held !== null) {
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
      },
    };
  },
});

/** Refusals only: what `editorBook` installs when it has no Observability. */
export const localTracer: Tracer = makeTracer(null);

let key: EditorState | null = null;
let current: Trace | null = null;

const flushTrace = (): void => {
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
export const traceFor = (state: EditorState, origin: string, changed = false): Trace | null => {
  const held = state.facet(tracer);
  if (held === null) {
    if (current !== null) flushTrace();
    return null;
  }
  if (key === state && current !== null) {
    if (changed) current.mutated();
    return current;
  }
  flushTrace();
  key = state;
  current = held.begin(state, origin, changed);
  return current;
};

/**
 * The trace this state's gesture is already inside, or null.
 *
 * Unlike `traceFor` this NEVER opens or flushes one: it is for code that runs
 * after the phases — `book.apply` and the satellite broadcast — and wants to
 * put its fields on the gesture's record without becoming a gesture itself.
 */
export const traceOf = (state: EditorState): Trace | null =>
  key === state && current !== null ? current : null;

/**
 * A rule's own verdict, on whichever trace is open.
 *
 * `note` and `noteTr` keep the signatures the rules already call, so adopting
 * the tracer changed no rule's behaviour and no rule's words.
 */
export function note(state: EditorState, s: TraceStep, kind: "rule" | "press" = "rule"): void {
  traceFor(state, kind === "press" ? "press" : "state")?.step(s);
}

export function noteTr(tr: Transaction, s: TraceStep): void {
  traceFor(tr.startState, "transaction")?.step(s);
}

let orphan: ((name: string, detail: string, ms: number) => void) | null = null;

/**
 * Where a derivation goes when NO gesture is open: a repaint from a scroll, a
 * resize, a viewport change. It is still work and still worth seeing, but it
 * belongs to nobody's keystroke — attaching it to whichever trace was left
 * open would date it to a gesture from a minute ago.
 */
export const onOrphanDerived = (
  handle: (name: string, detail: string, ms: number) => void,
): void => {
  orphan = handle;
};

/**
 * An outcome the editor has to report that is not a stage of a transaction: a
 * derivation that threw and fell back, a fix refused because the text moved.
 *
 * `failed` is our bug — a paint or an analysis that threw; `declined` is the
 * editor choosing not to act. One handler, registered by the ring bridge
 * (`packages/editor/src/observability.ts`) the way `onOrphanDerived` is, because the
 * places that report have a state, not an `ObservabilityService`.
 */
export type EditorOutcome = (
  rule: string,
  verdict: "failed" | "declined",
  detail: string,
  fields?: Readonly<Record<string, string | number | boolean>>,
) => void;

let outcome: EditorOutcome | null = null;

export const onEditorOutcome = (handle: EditorOutcome): void => {
  outcome = handle;
};

/**
 * Reports one outcome to the ring. With no ring — the editor running on its
 * own, in a harness — a failure still reaches the console rather than
 * vanishing; a decline is not worth saying there.
 */
export const reportOutcome: EditorOutcome = (rule, verdict, detail, fields) => {
  if (outcome !== null) {
    outcome(rule, verdict, detail, fields);
    return;
  }
  // oxlint-disable-next-line no-console
  if (verdict === "failed") console.error(`[${rule}]`, detail);
};

/** Fields onto the gesture that is open right now, if one is. */
export const annotateOpen = (
  fields: Readonly<Record<string, string | number | boolean>>,
): boolean => {
  if (current === null) return false;
  current.annotate(fields);
  return true;
};

onDerived((name, detail, ms) => {
  if (name === "keystroke" || name.startsWith("phase:")) return;
  if (current === null) orphan?.(name, detail, ms);
  else current.derived(name, detail, ms);
});
