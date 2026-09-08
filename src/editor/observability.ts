/**
 * The one bridge from the editor's instrument to Sefer's Observability ring.
 *
 * The editor keeps the instruments it was built with — `core/instrument.ts`
 * (one trace per transaction, the stages in order) and `core/timing.ts` (a
 * local span ring). They are deliberately not Effect: they run inside
 * `changeFilter` and `transactionFilter`, on the keystroke path, where a
 * service lookup per rule is not free and where there is no fiber to carry a
 * context anyway.
 *
 * What crosses into the ring is decided by the LEVEL, read once when a trace
 * begins (a keystroke must not change policy halfway through):
 *
 *   off       nothing.
 *   verdicts  ONE note per transaction, and only when a stage did not pass:
 *             the FIRST such stage, which is the decisive one and the one a
 *             `Refusal` names. A paragraph of ordinary typing writes nothing.
 *   spans     a span per stage (`editor.phase.<name>`, ms) AND a note per
 *             stage verdict, in pipeline order — so `recent()` reads as the
 *             flow of the keystroke through the plugins and facets.
 *   all       the same as `spans`.
 *
 * Every event carries the correlation `<bookId>#<trace seq>`, so the stages of
 * one keystroke group together and pair with the `book.apply` note the same
 * gesture produced.
 *
 * What does NOT cross: `derive` entries (scan, index, paint, decorate). Those
 * are the DERIVATION pipeline, they run several times per keystroke, and the
 * keystroke meter already reports their exclusive totals in one bounded note.
 * They are in `__sefer.editor.traces()` where a full picture belongs.
 */

import type { Level, ObservabilityService, Verdict as RingVerdict } from "../core/observability";
import {
  makeTracer,
  type Emitter,
  type TraceEntry,
  type Tracer,
  type Verdict as TraceVerdict,
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

const VOLUME: Readonly<Record<Level, number>> = { off: 0, verdicts: 1, spans: 2, all: 2 };

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
  const emit: Emitter = (trace) => {
    const volume = VOLUME[observability.level()];
    const correlation = `${bookId}#${trace.seq}`;
    // At `verdicts` the budget is one line per transaction: the first stage
    // that did not pass. Everything else this trace records is dropped.
    let noted = false;

    const record = (entry: TraceEntry): void => {
      if (volume === 0 || entry.kind === "derive") return;
      if (volume === 1) {
        if (noted || entry.verdict === "passed") return;
        noted = true;
      }
      const detail =
        entry.detail === undefined
          ? `doc=${trace.docLength} head=${trace.head}`
          : `${entry.detail} (doc=${trace.docLength} head=${trace.head})`;
      observability.note(`editor.${entry.name}`, VERDICT[entry.verdict], detail, correlation);
    };

    return {
      frame: (kind, phase, name) => {
        // The span opens WITH the frame, so its ms is the rule's own time
        // rather than a measurement taken after the fact.
        const done =
          volume > 1
            ? observability.span(`editor.${kind === "stage" ? "phase" : "command"}.${name}`, phase)
            : null;
        return (entry) => {
          done?.();
          record(entry);
        };
      },
      step: record,
      end: () => {},
    };
  };
  return makeTracer(emit);
};
