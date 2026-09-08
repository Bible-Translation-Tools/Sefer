/**
 * Per-rule verdicts: which door a keystroke went through, and what it decided.
 *
 * A no-op without a sink, so the instrument costs a facet read when nobody is
 * watching. The sink is a facet rather than a module global because two states
 * (a book and a window over it) trace separately, and because a test wants the
 * ring while the app wants the Observability bridge.
 */

import {
  EditorState,
  Facet,
  StateEffect,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export type Verdict = "refused" | "rewrote" | "moved" | "consumed" | "declined" | "passed";

export interface TraceStep {
  rule: string;
  verdict: Verdict;
  detail?: string;
}

export interface TraceEvent extends TraceStep {
  at: number;
  kind: "rule" | "press";
  docLength: number;
  head: number;
}

export type TraceSink = (e: TraceEvent) => void;

export const traceSink = Facet.define<TraceSink, TraceSink | null>({
  combine: (v) => v[0] ?? null,
});

export const traceStep = StateEffect.define<TraceStep>();

export const tracing = (state: EditorState): boolean => state.facet(traceSink) !== null;

let seq = 0;

export function note(state: EditorState, s: TraceStep, kind: "rule" | "press" = "rule"): void {
  const sink = state.facet(traceSink);
  if (!sink) return;
  sink({
    ...s,
    at: ++seq,
    kind,
    docLength: state.doc.length,
    head: state.selection.main.head,
  });
}

export function noteTr(tr: Transaction, s: TraceStep): void {
  const sink = tr.startState.facet(traceSink);
  if (!sink) return;
  sink({
    ...s,
    at: ++seq,
    kind: "rule",
    docLength: tr.changes.newLength,
    head: tr.newSelection.main.head,
  });
}

export const traceListener: Extension = EditorView.updateListener.of((u) => {
  const sink = u.state.facet(traceSink);
  if (!sink) return;
  for (const tr of u.transactions)
    for (const e of tr.effects)
      if (e.is(traceStep))
        sink({
          ...e.value,
          at: ++seq,
          kind: "rule",
          docLength: tr.state.doc.length,
          head: tr.state.selection.main.head,
        });
});

export const landingListener: Extension = EditorView.updateListener.of((u) => {
  if (!u.selectionSet || !u.state.facet(traceSink)) return;
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
