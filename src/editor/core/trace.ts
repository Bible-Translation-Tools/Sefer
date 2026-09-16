/**
 * The legacy per-event view of the trace: a flat `TraceSink`, the ring behind
 * `ringSink`, and the two update listeners.
 *
 * `core/instrument.ts` is the instrument now — one `Trace` per transaction,
 * with the stages in order. This file is the adapter that keeps the flat
 * "one event per decision" shape working for a harness that wants a ring and a
 * demo that wants a table, so adopting the tracer cost no call site.
 *
 * `note`, `noteTr` and `tracing` are re-exported from the instrument rather
 * than reimplemented: the rules import them from here today, and there is only
 * one implementation to import.
 */

import { StateEffect, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  makeTracer,
  note,
  tracer,
  type Emitter,
  type TraceEntry,
  type TraceStep,
  type Tracer,
} from "./instrument";

export { note, noteTr, tracing } from "./instrument";
export type { TraceStep, Verdict } from "./instrument";

/**
 * One decision, flat. `docLength`/`head` are the trace's — the state the
 * transaction began from — rather than each entry's: an entry is a frame
 * around a rule, and the rule ran against that state.
 */
export interface TraceEvent extends TraceStep {
  at: number;
  kind: "rule" | "press";
  docLength: number;
  head: number;
}

export type TraceSink = (e: TraceEvent) => void;

/** A flat sink as a `Tracer`. The adapter, and the only one. */
export const sinkTracer = (sink: TraceSink): Tracer => {
  const emit: Emitter = (trace) => {
    const one = (e: TraceEntry): void => {
      sink({
        rule: e.phase === "" ? e.name : `${e.phase}:${e.name}`,
        verdict: e.verdict,
        ...(e.detail === undefined ? {} : { detail: e.detail }),
        at: e.at,
        kind: trace.origin === "press" ? "press" : "rule",
        docLength: trace.docLength,
        head: trace.head,
      });
    };
    // A flat sink has no gesture record to put fields on.
    return { frame: () => one, step: one, annotate: () => {}, end: () => {} };
  };
  return makeTracer(emit);
};

/**
 * `traceSink.of(sink)` — the extension a harness or a demo installs.
 *
 * Not a Facet any more: the facet is `instrument.tracer`, and there is exactly
 * one hot-path facet read. Keeping the `.of` shape means `traceSink.of(mine)`
 * still reads the same at both call sites.
 */
export const traceSink = {
  of: (sink: TraceSink): Extension => tracer.of(sinkTracer(sink)),
};

/**
 * A verdict carried on a transaction, for a rule that decides in one place and
 * is only sure in another (a view plugin, an async lint).
 */
export const traceStep = StateEffect.define<TraceStep>();

export const traceListener: Extension = EditorView.updateListener.of((u) => {
  for (const tr of u.transactions)
    for (const e of tr.effects) if (e.is(traceStep)) note(u.state, e.value);
});

/**
 * Where the caret actually landed, after every rule had its say.
 *
 * The one thing a trace of the rules cannot tell you: settlement, the clip and
 * the view all move the caret, and this is the answer they agreed on. Noted as
 * a `press` so it reads as the end of the gesture rather than a rule's verdict.
 */
export const landingListener: Extension = EditorView.updateListener.of((u) => {
  if (!u.selectionSet) return;
  const before = u.startState.selection.main;
  const after = u.state.selection.main;
  note(
    u.state,
    {
      rule: "caret",
      verdict: after.head === before.head ? "passed" : "moved",
      detail: `landed ${before.head}:${before.assoc} → ${after.head}:${after.assoc}`,
    },
    "press",
  );
});

export function ringSink(size = 512): {
  sink: TraceSink;
  events(): TraceEvent[];
  dump(match?: string): string;
  clear(): void;
} {
  const buf: (TraceEvent | null)[] = Array.from({ length: size }, () => null);
  let at = 0;
  return {
    sink: (e) => {
      buf[at] = e;
      at = (at + 1) % size;
    },
    events: () => {
      const out: TraceEvent[] = [];
      for (let i = 0; i < size; i++) {
        const e = buf[(at + i) % size];
        if (e) out.push(e);
      }
      return out;
    },
    dump(match) {
      const all = this.events();
      const rows = match
        ? all.filter((e) => e.rule.includes(match) || (e.detail ?? "").includes(match))
        : all;
      if (!rows.length)
        return all.length
          ? `trace — ${all.length} step(s) recorded, none matching ${JSON.stringify(match)}`
          : "trace — nothing recorded (is a sink attached?)";
      return [
        `trace — ${rows.length}${match ? ` of ${all.length}` : ""} step(s), oldest first`,
        `  seq  kind   rule                  verdict    doc  caret  detail`,
        ...rows.map(
          (e) =>
            `${String(e.at).padStart(5)}  ${e.kind.padEnd(5)}  ${e.rule.padEnd(20)}  ` +
            `${e.verdict.padEnd(9)}  ${String(e.docLength).padStart(5)} ${String(e.head).padStart(6)}  ${e.detail ?? ""}`,
        ),
      ].join("\n");
    },
    clear() {
      buf.fill(null);
      at = 0;
    },
  };
}

let lastError: string | null = null;
export const stateError = () => lastError;
export const clearStateError = () => {
  lastError = null;
};
export const stateFailed = (where: string, err: unknown) => {
  lastError = `${where}: ${String(err)}`;
  console.error(`[${where}]`, err);
};
