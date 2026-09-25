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

import type {
  Level,
  ObservabilityService,
  Operation,
  Verdict as RingVerdict,
} from "#core/observability";

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

/**
 * The trace's vocabulary in the ring's. Only `moved` has no counterpart: a
 * settled caret is the editor rewriting the selection the user asked for, so
 * it reads as `rewrote` — the same verdict a rewritten change list gets.
 */
const VERDICT: Readonly<Record<TraceVerdict, RingVerdict>> = {
  refused: "refused",
  rewrote: "rewrote",
  moved: "rewrote",
  consumed: "consumed",
  declined: "declined",
  passed: "passed",
};

// `all` is a level of its own again: it is what turns the derivation pipeline
// into visible events, and that is several per keystroke.
const VOLUME: Readonly<Record<Level, number>> = { off: 0, verdicts: 1, spans: 2, all: 3 };

const round = (ms: number): number => Math.round(ms * 1000) / 1000;

/** How long a repaint burst must be quiet before it counts as finished. */
const BURST_MS = 120;

/**
 * Repaints nobody typed for — a scroll, a resize, a viewport change, or a
 * decoration pass following a gesture that has already painted — coalesced on
 * the TRAILING edge into one `editor.render`.
 *
 * ONE of these for the application, not one per book. A continuous scroll is
 * thousands of view updates and one piece of work, and `onOrphanDerived` holds
 * a single handler anyway — registering per book meant the last book opened
 * won, and every repaint after that was labelled with its id whoever caused
 * it. So the burst names no book: a repaint is not necessarily about one.
 */
let repaintInto: ObservabilityService | null = null;
/**
 * The trace of the gesture in flight, for work that will FOLLOW it.
 *
 * Read synchronously, inside the gesture — the analysis scheduler is armed
 * from `book.changes`, which runs inside `accept()` — so this is accurate at
 * the only moment it is asked. It is not a propagation mechanism: nothing
 * async may read it, and nothing does.
 */
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

// Outcomes outside any transaction go to the same ring as the repaints, as
// loose notes: they belong to no gesture, and naming one would date them.
onEditorOutcome((rule, verdict, detail, fields) => {
  repaintInto?.note(rule, verdict, detail, fields);
});

/** Level `off`: the trace still runs (the refusal slot needs it), silently. */
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
 * window over the book traces under the same correlation.
 */
export const observabilityTracer = (
  observability: ObservabilityService,
  bookId: string,
): Tracer => {
  repaintInto ??= observability;
  const emit: Emitter = (trace) => {
    const volume = VOLUME[observability.level()];
    if (volume === 0) return SILENT;
    // ONE wide event per transaction. The stages are FIELDS on it, not spans:
    // a phase rule runs in tens of microseconds and a browser coarsens
    // `performance.now()` to 100µs unless the page is cross-origin isolated,
    // so a span per stage reports a number the clock refused to measure —
    // eleven spans, every one of them 0ms. As attributes the same numbers
    // still aggregate across a session, which is the question worth asking.
    // Opened as a selection and renamed at the end if the document changed:
    // a gesture that turns out to be neither is still a caret move, and the
    // name a record is written under is decided when the work is done.
    const operation = observability.operation("editor.selection", {
      "book.id": bookId,
      "editor.seq": trace.seq,
      "editor.origin": trace.origin,
      "editor.doc_length": trace.docLength,
      "editor.head": trace.head,
    });
    openGesture = operation.trace;
    const opened = performance.now();
    // The instrument closes a trace when the NEXT transaction opens, so wall
    // time from here to `end` is mostly the reader sitting still. The last
    // thing that actually happened is the honest end of the work.
    let active = opened;
    // The stage that decided the transaction — the one a `Refusal` names.
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
    // The derivation pipeline, summed and counted. The COUNT is the half worth
    // having: "decorate ran four times" is a fact about the keystroke, where
    // four separate 0ms spans are four readings the clock refused to take.
    const derived = new Map<string, { ms: number; n: number }>();

    const record = (entry: TraceEntry): void => {
      // Past the paint this gesture is over, and a derivation arriving now is
      // a repaint that merely followed it — the analysis publishing findings,
      // say. It belongs to `editor.render`, not to the keystroke.
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
        // At `all`, each run is also a point in time on the gesture: WHO
        // derived what, in what order. The clock cannot size these, but order
        // and identity are not measurements and survive its floor.
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
      // A stage that DECIDED is worth its own record at every level; a stage
      // that passed said nothing a field cannot say.
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
        // The meter reports once the browser has painted, which is the end of
        // the gesture as a person experienced it.
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
      // A gesture that only moved the caret is not a mutation, and at
      // `verdicts` it is not worth a record at all: arrow keys, clicks and
      // drags are the bulk of the volume and almost never the question.
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
