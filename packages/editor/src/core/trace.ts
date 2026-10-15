/**
 * The legacy per-event view of the trace: a flat `TraceSink`, for the test
 * harness.
 *
 * `core/instrument.ts` is the instrument now — one `Trace` per transaction,
 * with the stages in order. This file is the adapter that keeps the flat
 * "one event per decision" shape working for the harness, so adopting the
 * tracer cost no call site.
 *
 * `note`, `noteTr` and `tracing` are re-exported from the instrument rather
 * than reimplemented: the rules import them from here today, and there is only
 * one implementation to import.
 */

import { type Extension } from "@codemirror/state";

import {
  makeTracer,
  reportOutcome,
  tracer,
  type Emitter,
  type TraceEntry,
  type TraceStep,
  type Tracer,
} from "./instrument";

export { note, noteTr, tracing } from "./instrument";
export type { TraceStep, TraceVerdict } from "./instrument";

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
const sinkTracer = (sink: TraceSink): Tracer => {
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
 * A derivation threw and the caller fell back to an empty answer: our bug,
 * so `failed` — the one verdict the dev console prints unasked.
 */
export const stateFailed = (where: string, err: unknown): void => {
  reportOutcome(
    `editor.${where}`,
    "failed",
    err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  );
};
