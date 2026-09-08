/**
 * The one bridge from the editor's own instruments to Sefer's Observability
 * ring.
 *
 * The editor keeps the instruments it was built with: `core/timing.ts` (a
 * local span ring, armed only when someone is listening) and `core/trace.ts`
 * (per-rule verdicts through a facet-supplied sink). They are deliberately not
 * Effect: they run inside `changeFilter` and `transactionFilter`, on the
 * keystroke path, where a service lookup per rule is not free and where there
 * is no fiber to carry a context anyway.
 *
 * What DOES belong in the ring is the verdict: which rule refused a keystroke,
 * which one rewrote it. That is one line per rule per gesture, it is the thing
 * a bug report needs, and it is already bounded. Spans are not forwarded — the
 * keystroke meter already counts them, and a span per rule per keystroke would
 * be the ring's whole capacity in a paragraph of typing.
 */

import type { ObservabilityService, Verdict as RingVerdict } from "../core/observability";
import type { TraceSink, Verdict as TraceVerdict } from "./core/trace";

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

/**
 * A `TraceSink` that forwards rule DECISIONS to `observability.note`.
 *
 * Pass it to the `traceSink` facet of a state, or let `editorBook` install it
 * (it does, when given an `Observability`). The detail stays counts and
 * positions — never document text — because the ring is evidence, not content.
 *
 * `passed` is dropped. The phase installer notes every rule it enters as
 * passed, so forwarding those would put ten lines per keystroke into a
 * 2000-entry ring and a typed paragraph would evict everything worth keeping.
 * A rule that passed is the ordinary case and says nothing; the local ring
 * (`recent()` in `core/timing.ts`, `ringSink` in `core/trace.ts`) is where a
 * full per-rule trace belongs.
 */
export const observabilitySink =
  (observability: ObservabilityService): TraceSink =>
  (event) => {
    if (event.verdict === "passed") return;
    const detail =
      event.detail === undefined
        ? `doc=${event.docLength} head=${event.head}`
        : `${event.detail} (doc=${event.docLength} head=${event.head})`;
    observability.note(`editor.${event.rule}`, VERDICT[event.verdict], detail);
  };
