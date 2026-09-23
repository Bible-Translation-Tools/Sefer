/**
 * Sink 1 of the diagnostics fan-out: the engine's
 * diagnostics as inline marks and gutter actions.
 *
 * TWO sources, one linter. Galley's per-book diagnostics are rebuilt from the
 * CURRENT state's analysis every keystroke, so an inline mark cannot be stale —
 * the freshness discipline the other sinks need is bought here by not caching.
 * Sous's corpus findings cannot be rebuilt here at all: they are whole-corpus
 * products that arrive from `ProjectAnalysis` long after the keystroke that
 * provoked them, so they are PUSHED into `sousField` and are dropped, never
 * shifted, the moment the document moves. That keeps the corpus half entirely
 * off the keystroke hot path: a keystroke costs one synchronous engine parse and
 * one field reset, and no corpus work at all.
 *
 * A finding whose span is entirely inside hidden markup is dropped by default,
 * whichever producer said so: it reads as an underline on nothing. That test
 * consults the paint index, not the decoration set.
 *
 * A fix carries the stamp of the text it was computed from and is discarded if
 * the document moved under it. Sous findings never carry one — they measure.
 */

import { type Diagnostic as CmDiagnostic, forceLinting, linter } from "@codemirror/lint";
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import {
  type EngineStamp,
  diagnosticFixLabel,
  diagnosticMessage,
  diagnosticName,
  diagnosticSeverity,
  stampMatches,
  stampOf,
  versionOf,
} from "#core/galley";
import type { SourceStamp } from "#core/source/source";

import { analyzed, analyzer } from "../core/analyzer";
import { structureAt } from "../core/docStructure";
import { PAINT_PORT } from "../core/editorState";
import { trusted } from "../core/kernel";
import { span } from "../core/timing";

interface Finding {
  code: number;
  name: string;
  severity: "error" | "warning" | "info" | "hint" | null;
  from: number;
  to: number;
  second: { from: number; to: number } | null;
  message: string;
  fixLabel: string | null;
  fix: { from: number; to: number; insert: string }[] | null;
  hidden: boolean;
  line: number;
  stamp: EngineStamp;
}

export type HiddenTest = (state: EditorState, from: number, to: number) => boolean;

/**
 * The default hidden test: the paint index. In regular mode a diagnostic can
 * sit entirely inside markup the reader cannot see, and an underline on
 * nothing is noise — so a finding is marked `hidden` when the painter covered
 * its whole span, and `usfmLinter` drops those by default.
 */
const hiddenByPaint: HiddenTest = (state, from, to) => PAINT_PORT.hidden(state, from, to);

function findings(state: EditorState, isHidden?: HiddenTest): Finding[] {
  const analysis = structureAt(state).analysis;
  if (!analysis) return [];
  const done = span("diagnostics-render");
  const version = versionOf(analysis);
  const stamp = stampOf(analysis);
  const slice = (from: number, to: number) => state.doc.sliceString(from, to);
  const out: Finding[] = [];
  for (const f of analysis.dish.diagnostics) {
    const severity = diagnosticSeverity(f, version);
    const at = f.span();
    out.push({
      code: f.code().code,
      name: diagnosticName(f),
      severity,
      from: at.from,
      to: at.to,
      second: f.second(),
      message: diagnosticMessage(f, slice),
      fixLabel: diagnosticFixLabel(f),
      fix: f.fix(),
      hidden: isHidden ? isHidden(state, at.from, at.to) : false,
      line: state.doc.lineAt(Math.min(at.from, state.doc.length)).number,
      stamp,
    });
  }
  done();
  return out;
}

function applyFix(
  view: EditorView,
  fix: { from: number; to: number; insert: string }[],
  stamp?: EngineStamp,
): boolean {
  // A fix carries the stamp of the text it was computed from. Re-analysing the
  // live document is the cheap way to prove it still describes this text — the
  // engine's own hash, not a length, so an equal-length edit under the
  // tooltip is caught.
  if (
    stamp !== undefined &&
    !stampMatches(stamp, analyzed(view.state.facet(analyzer), view.state.doc.toString()))
  ) {
    console.warn("[engine] fix discarded: the document moved under it");
    return false;
  }
  const done = span("apply-fix", `${fix.length} edits`);
  view.dispatch({
    changes: fix.map((e) => ({ from: e.from, to: e.to, insert: e.insert })),
    userEvent: "input.usfm.fix",
    annotations: trusted.of("lint-fix"),
    scrollIntoView: true,
  });
  done();
  view.focus();
  return true;
}

const SEVERITY_CLASS: Record<string, string> = {
  error: "usfm-lint-error",
  warning: "usfm-lint-warn",
  info: "usfm-lint-info",
  hint: "usfm-lint-info",
};

/**
 * A corpus finding, as much of Sefer's one shape (`src/core/findings`) as the
 * editor needs in order to draw it. Deliberately structural rather than an
 * import of `Finding`: the editor renders what it is handed, and core's shape
 * satisfies this without core learning that CodeMirror exists.
 *
 * `stamp` is the Book's `SourceStamp` for the text the offsets name. It is the
 * freshness authority inside one Book's lifetime, and the caller is expected to
 * have filtered on it already — `sousField` drops the whole set on the next
 * document change regardless, because nothing here shifts an offset.
 */
export interface CorpusFinding {
  readonly id: string;
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly from: number;
  readonly to: number;
  readonly stamp: SourceStamp;
}

const NO_CORPUS: readonly CorpusFinding[] = [];

/** Replace the corpus findings shown for the book in this state. */
const setCorpusFindings = StateEffect.define<readonly CorpusFinding[]>();

/**
 * Sink 1's second source: the Sous findings for the instantiated book.
 *
 * Held rather than computed, because no amount of work in this process can
 * produce them — they are a whole-corpus product. The update rule is the
 * freshness rule in two lines: a document change invalidates every offset in
 * the set, and the set is DROPPED rather than mapped through the changes.
 * Mapping would produce a plausible underline in the wrong place, which is the
 * failure the stamps exist to prevent; the next publication brings a correct
 * set within the scheduler's quiet window.
 */
const sousField = StateField.define<readonly CorpusFinding[]>({
  create: () => NO_CORPUS,
  update(held, tr) {
    if (tr.docChanged) return NO_CORPUS;
    for (const effect of tr.effects) if (effect.is(setCorpusFindings)) return effect.value;
    return held;
  },
});

/** What the linter is currently showing from the corpus half. */
const corpusFindings = (state: EditorState): readonly CorpusFinding[] =>
  state.field(sousField, false) ?? NO_CORPUS;

/**
 * Hand the editor the corpus findings for its book, and re-lint.
 *
 * The dispatch changes no document, so the bound Book ignores it (`fromView`
 * accepts document changes only) — this is presentation, not an edit.
 *
 * `forceLinting` alone is NOT enough and was the whole of the first bug here:
 * it only shortens a run the plugin has already scheduled, and the plugin only
 * schedules one when the document changed. A corpus publication lands ~150 ms
 * after the last keystroke, by which time that run is long over — so the
 * findings sat in the field and were never drawn. `needsRefresh` below is what
 * makes the field a lint input; this call then just skips the delay.
 */
export const showCorpusFindings = (view: EditorView, list: readonly CorpusFinding[]): void => {
  view.dispatch({ effects: setCorpusFindings.of(list) });
  forceLinting(view);
};

/**
 * The inline linter: Galley's diagnostics from the current state, plus whatever
 * corpus findings were last pushed in. ONE `linter`, so one gutter, one
 * tooltip and one keyboard order over both producers.
 *
 * `source` is what tells them apart for a reader — `onion/<code>` or
 * `sous/<code>` — and it is the tooltip's footer line.
 */
export function usfmLinter(
  isHidden: HiddenTest = hiddenByPaint,
  suppressHidden: () => boolean = () => true,
): Extension {
  return [
    sousField,
    linter(
      (view) => {
        const out: CmDiagnostic[] = [];
        for (const f of findings(view.state, isHidden)) {
          if (f.severity === null) continue;
          if (f.hidden && suppressHidden()) continue;
          const fix = f.fix;
          const stamp = f.stamp;
          out.push({
            from: f.from,
            to: Math.max(f.to, f.from + 1),
            severity: f.severity,
            source: `onion/${f.name}`,
            markClass: SEVERITY_CLASS[f.severity] ?? "usfm-lint-info",
            message: f.message,
            actions:
              fix === null
                ? undefined
                : [
                    {
                      // "Fix: <label>" so the button says what it will do; the
                      // catalogue's label on its own reads as one more noun in
                      // a tooltip that is already mostly nouns.
                      name: `Fix: ${f.fixLabel ?? "repair"}`,
                      markClass: "usfm-fix-action",
                      apply(target) {
                        applyFix(target, fix, stamp);
                      },
                    },
                  ],
          });
        }
        const length = view.state.doc.length;
        for (const f of corpusFindings(view.state)) {
          // A publication whose offsets run past this document describes text
          // this view does not hold. Dropped, never clamped.
          if (f.from < 0 || f.to > length || f.from > f.to) continue;
          if (suppressHidden() && isHidden(view.state, f.from, f.to)) continue;
          out.push({
            from: f.from,
            to: Math.max(f.to, Math.min(f.from + 1, length)),
            severity: f.severity,
            source: `sous/${f.code}`,
            markClass: SEVERITY_CLASS[f.severity] ?? "usfm-lint-info",
            message: f.message,
            // Sous measures; it never offers an edit (`fixes.preview` refuses
            // it `NotEngineFix`), so there is no action to offer here either.
          });
        }
        return out;
      },
      {
        delay: 150,
        // The second source moves without a document change, and a document
        // change is the only thing the lint plugin watches by default. This is
        // the hook that makes `sousField` a lint input.
        needsRefresh: (update) =>
          update.state.field(sousField, false) !== update.startState.field(sousField, false),
      },
    ),
  ];
}
