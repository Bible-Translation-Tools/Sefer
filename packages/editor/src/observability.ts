/**
 * The one bridge from the editor's instrument to Sefer's Observability ring.
 *
 * The editor keeps the instruments it was built with — `core/instrument.ts`
 * (one trace per transaction, the stages in order) and `core/timing.ts` (a
 * local span ring). They are deliberately not Effect: they run inside
 * `changeFilter` and `transactionFilter`, on the keystroke path, where a
 * service lookup per rule is not free and where there is no fiber to carry a
 * context anyway. So this is the one place an `Operation` is passed by hand
 * rather than provided through the Effect context.
 *
 * ONE WIDE EVENT PER TRANSACTION. The stages are fields on it — one
 * `editor.phase.<name>.ms` each — not eleven spans. A phase rule runs in tens
 * of microseconds, and a browser coarsens `performance.now()` to 100µs unless
 * the page is cross-origin isolated, so a span per stage reported a duration
 * the clock had refused to measure: eleven children, every one of them 0ms.
 * The same numbers as attributes still aggregate over a session, which is the
 * question a keystroke's timing can actually answer.
 *
 * A gesture that only moved the caret is `editor.selection`; one that changed
 * the document is `editor.mutation`. The name is chosen at the END because a
 * command opens the trace on the keypress and dispatches its transaction into
 * the same one, so whether it mutated is not known when the trace opens.
 *
 * What crosses into the ring is decided by the LEVEL, read once when a trace
 * begins (a keystroke must not change policy halfway through):
 *
 *   off       nothing.
 *   verdicts  mutations only, and only the stages that did not pass. Arrow
 *             keys, clicks and drags write nothing; a paragraph of ordinary
 *             typing writes one record per keystroke with no stage fields.
 *   spans     every transaction, selections included, with the per-phase
 *             timings as fields.
 *   all       the same as `spans`.
 *
 * What does NOT cross: `derive` entries (scan, index, paint, decorate). Those
 * are the DERIVATION pipeline, they run several times per keystroke, and the
 * keystroke meter already reports their exclusive totals in one bounded note.
 * They stay on the local trace.
 */

type RingVerdict =
  | "ready"
  | "passed"
  | "refused"
  | "rewrote"
  | "consumed"
  | "declined"
  | "unavailable"
  | "failed";

type Level = "off" | "verdicts" | "spans" | "all";

type Attrs = Readonly<Record<string, string | number | boolean>>;

type EditorOperationName = "editor.mutation" | "editor.selection" | "editor.render";

interface Operation {
  readonly trace: string;
  readonly attr: (attrs: Attrs) => void;
  readonly rename: (name: EditorOperationName) => void;
  readonly end: (verdict?: RingVerdict, attrs?: Attrs, ms?: number) => number;
  readonly note: (rule: string, verdict: RingVerdict, detail?: string, attrs?: Attrs) => void;
}

/**
 * The slice of a host's observability the editor writes to. Structural, so the
 * package depends on nobody's tracing: Sefer's `EditorObservability` satisfies
 * it as it stands, and a host with none passes nothing.
 */
export interface EditorObservability {
  readonly level: () => Level;
  readonly operation: (name: EditorOperationName, attrs?: Attrs) => Operation;
  readonly note: (rule: string, verdict: RingVerdict, detail?: string, attrs?: Attrs) => void;
}

import {
  makeTracer,
  onEditorOutcome,
  onOrphanDerived,
  type Emitter,
  type TraceEmit,
  type TraceEntry,
  type Tracer,
  type TraceVerdict,
} from "./core/instrument";

const VERDICT: Readonly<Record<TraceVerdict, RingVerdict>> = {
  refused: "refused",
  rewrote: "rewrote",
  moved: "rewrote",
  consumed: "consumed",
  declined: "declined",
  passed: "passed",
};

const VOLUME: Readonly<Record<Level, number>> = { off: 0, verdicts: 1, spans: 2, all: 3 };

const round = (ms: number): number => Math.round(ms * 1000) / 1000;

const BURST_MS = 120;

let repaintInto: EditorObservability | null = null;
let openGesture: string | null = null;

/** The gesture in flight, for whatever the gesture is about to cause. */
export const gestureTrace = (): string | undefined => openGesture ?? undefined;
let burst: { op: Operation; derived: Map<string, { ms: number; n: number }> } | null = null;
let closing: ReturnType<typeof setTimeout> | undefined;

const openBurst = (): Operation | null => {
  const into = repaintInto;
  if (into === null || VOLUME[into.level()] < 2) return null;
  burst ??= { op: into.operation("editor.render"), derived: new Map() };
  clearTimeout(closing);
  closing = setTimeout(() => {
    const ending = burst;
    burst = null;
    if (ending === null) return;
    const totals: Record<string, string | number | boolean> = {};
    let whole = 0;
    for (const [name, count] of ending.derived) {
      totals[`editor.derive.${name}.ms`] = count.ms;
      totals[`editor.derive.${name}.n`] = count.n;
      whole = round(whole + count.ms);
    }
    ending.op.end("ready", totals, whole);
  }, BURST_MS);
  return burst.op;
};

const repaint = (name: string, detail: string, ms: number): void => {
  if (openBurst() === null || burst === null) return;
  const held = burst.derived.get(name) ?? { ms: 0, n: 0 };
  held.ms = round(held.ms + ms);
  held.n += 1;
  burst.derived.set(name, held);
  if (detail !== "" && held.n === 1) burst.op.attr({ [`editor.derive.${name}.detail`]: detail });
};

/**
 * Fields onto the repaint now in flight, opening one if none is.
 *
 * What republished findings costs IS the repaint it provokes, so the count
 * belongs on that record rather than on one of its own — a publication fans
 * out to every open book, and an event each would be noise about one fact.
 */
export const annotateRepaint = (
  fields: Readonly<Record<string, string | number | boolean>>,
): void => {
  openBurst()?.attr(fields);
};

onOrphanDerived(repaint);

onEditorOutcome((rule, verdict, detail, fields) => {
  repaintInto?.note(rule, verdict, detail, fields);
});

const SILENT: TraceEmit = {
  frame: () => () => {},
  step: () => {},
  annotate: () => {},
  end: () => {},
};

/**
 * The editor's instrument, writing Sefer's ring.
 *
 * `editorBook` installs this on the canonical state when it was given an
 * Observability; every state that shares the book shares the trace, so a
 * satellite edit the book judges traces under the same correlation.
 */
export const observabilityTracer = (observability: EditorObservability, bookId: string): Tracer => {
  repaintInto ??= observability;
  const emit: Emitter = (trace) => {
    const volume = VOLUME[observability.level()];
    if (volume === 0) return SILENT;
    const operation = observability.operation("editor.selection", {
      "book.id": bookId,
      "editor.seq": trace.seq,
      "editor.origin": trace.origin,
      "editor.doc_length": trace.docLength,
      "editor.head": trace.head,
    });
    openGesture = operation.trace;
    const opened = performance.now();
    let active = opened;
    let decided: string | undefined;
    let verdict: RingVerdict = "passed";
    // A gesture is over when it has PAINTED, not when the next one begins.
    //
    // The instrument closes a trace lazily, and a derivation lands on
    // whichever trace is open — so the debounced analysis firing 120ms later
    // triggered a decorate whose derive attached to the keystroke and dragged
    // its duration with it. Measured: gestures whose own work was 2ms and
    // whose paint landed at 30ms were reporting 152ms. Sealing at the paint
    // ends the record there; anything after it is a repaint nobody typed for,
    // which `editor.render` already exists to carry.
    let sealed = false;
    const timings: Record<string, string | number | boolean> = {};
    const derived = new Map<string, { ms: number; n: number }>();

    const record = (entry: TraceEntry): void => {
      if (sealed) {
        if (entry.kind === "derive") repaint(entry.name, entry.detail ?? "", entry.ms);
        return;
      }
      active = performance.now();
      if (entry.kind === "derive") {
        const held = derived.get(entry.name) ?? { ms: 0, n: 0 };
        held.ms = round(held.ms + entry.ms);
        held.n += 1;
        derived.set(entry.name, held);
        if (volume > 2)
          operation.note(`derive.${entry.name}`, "passed", entry.detail, {
            "derive.ms": entry.ms,
          });
        return;
      }
      if (entry.verdict !== "passed" && decided === undefined) {
        decided = entry.name;
        verdict = VERDICT[entry.verdict];
      }
      // Only a phase the clock could see. Most read 0 — below the browser's
      // 100µs floor — and eleven zero fields were half the bytes of every
      // keystroke on disk; an absent phase aggregates as 0 (`// 0` in jq).
      if (volume > 1 && entry.ms > 0) timings[`editor.phase.${entry.name}.ms`] = entry.ms;
      if (entry.verdict !== "passed")
        operation.note(`editor.${entry.name}`, VERDICT[entry.verdict], entry.detail);
    };

    return {
      frame: () => record,
      step: record,
      annotate: (fields) => {
        if (sealed) return;
        active = performance.now();
        operation.attr(fields);
        if (fields["editor.to_paint_ms"] !== undefined) {
          sealed = true;
          close();
        }
      },
      end: () => {
        if (sealed) return;
        close();
      },
    };

    function close(): void {
      openGesture = null;
      const mutation = trace.changed;
      if (!mutation && volume < 2) return;
      operation.rename(mutation ? "editor.mutation" : "editor.selection");
      const totals: Record<string, string | number | boolean> = {};
      for (const [name, held] of derived) {
        totals[`editor.derive.${name}.ms`] = held.ms;
        totals[`editor.derive.${name}.n`] = held.n;
      }
      operation.end(
        verdict,
        {
          ...timings,
          ...totals,
          "editor.mutated": mutation,
          ...(decided === undefined ? {} : { "editor.decided": decided }),
        },
        round(active - opened),
      );
    }
  };

  return makeTracer(emit);
};
