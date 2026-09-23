/**
 * The analyzer seam: how a CodeMirror state reaches the USFM engine.
 *
 * The spike this editor is ported from called a module-level engine singleton
 * (`runAnalyze`). Sefer has no singleton — the engine's lifetime belongs to
 * the `Galley` Layer, and each Book gets its own memo (`galley.memoize()`), so
 * a keystroke in Philemon does not evict the parse of Jude. A facet is the one
 * CodeMirror-shaped way to hand a state a capability without a global: whoever
 * builds the state supplies the function, and every field, rule and command
 * reads it back out of the state it was already given.
 *
 * The analyzer must be synchronous and cheap on a repeat call. `Galley.analyze`
 * is synchronous by design (a fiber per keystroke is a budget we do not have)
 * and `memoize()` makes the repeat call free.
 */

import { Facet } from "@codemirror/state";

import type { Analysis } from "#core/galley";

import { span } from "./timing";

/** One parse of one text. Canonical LF; the engine refuses a `\r`. */
export type Analyze = (text: string) => Analysis;

/**
 * The analyzer for a state. Required: a state built without one cannot read
 * its own structure, and failing at the first read with a named error beats
 * every downstream symptom of an empty parse.
 */
export const analyzer = Facet.define<Analyze, Analyze>({
  combine: (values) =>
    values[0] ??
    (() => {
      throw new Error("usfmEditor: no analyzer facet");
    }),
});

// The meter reports how many parses a gesture cost. `Analysis.revision` is
// monotonic per engine handle and changes only when the engine actually
// parsed, so watching it counts real parses and not memo hits — which is the
// number that says whether a gesture stayed inside its budget.
let parses = 0;
let lastRevision = -1;

/**
 * Run an analyzer and count the parse it caused.
 *
 * Every call site inside the editor goes through this rather than calling the
 * facet's function directly, so `analyzeCount` sees the whole picture. Two
 * books interleaving their (independent) revision sequences can make this
 * over-count; it is a meter, not a ledger.
 */
export const analyzed = (analyze: Analyze, text: string): Analysis => {
  // Timed as well as counted, so the keystroke meter's breakdown adds up to
  // its gesture: the parse is the largest thing a keystroke does that is not
  // one of the derivation spans, and unattributed time is the one bucket a
  // reader cannot act on.
  const done = span("analyze");
  const analysis = analyze(text);
  done();
  if (analysis.revision !== lastRevision) {
    lastRevision = analysis.revision;
    parses += 1;
  }
  return analysis;
};

/** Parses caused since the module loaded. Read by `keystrokeMeter`. */
export const analyzeCount = (): number => parses;
