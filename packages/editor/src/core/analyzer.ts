import { Facet } from "@codemirror/state";
import type { Analysis } from "@sefer/text/engine/analysis";

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
