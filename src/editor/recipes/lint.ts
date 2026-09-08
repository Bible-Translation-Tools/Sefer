/**
 * Sink 1 of the diagnostics fan-out (editor-and-save §2): the engine's
 * diagnostics as inline marks and gutter actions.
 *
 * Rebuilt from the CURRENT state's analysis every keystroke, so an inline mark
 * cannot be stale — the freshness discipline the other sinks need is bought here
 * by not caching. A finding whose span is entirely inside hidden markup is
 * dropped by default: it reads as an underline on nothing. That test consults
 * the paint index, not the decoration set.
 *
 * A fix carries the stamp of the text it was computed from and is discarded if
 * the document moved under it.
 */

import { type Diagnostic as CmDiagnostic, linter } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
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
} from "../../core/galley";
import { analyzed, analyzer } from "../core/analyzer";
import { structureAt } from "../core/docStructure";
import { PAINT_PORT } from "../core/editorState";
import { trusted } from "../core/kernel";
import { span } from "../core/timing";

export interface Finding {
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
export const hiddenByPaint: HiddenTest = (state, from, to) => PAINT_PORT.hidden(state, from, to);

export function findings(state: EditorState, isHidden?: HiddenTest): Finding[] {
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

export function applyFix(
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

export function usfmLinter(
  isHidden: HiddenTest = hiddenByPaint,
  suppressHidden: () => boolean = () => true,
) {
  return linter(
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
                    name: f.fixLabel ?? "fix",
                    apply(target) {
                      applyFix(target, fix, stamp);
                    },
                  },
                ],
        });
      }
      return out;
    },
    { delay: 150 },
  );
}
