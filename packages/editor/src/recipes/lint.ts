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
} from "@sefer/text/engine/analysis";
import type { SourceStamp } from "@sefer/text/source";

import { analyzed, analyzer } from "../core/analyzer";
import { structureAt } from "../core/docStructure";
import { PAINT_PORT } from "../core/editorState";
import { carryForward } from "../core/forward";
import { reportOutcome } from "../core/instrument";
import { trusted } from "../core/kernel";
import { span } from "../core/timing";
import { leaveNumbersToTheMenu, removesMarker, suggestedNumber } from "../core/verseLines";

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
  point: boolean;
  line: number;
  stamp: EngineStamp;
}

const SLOT_FINDINGS: Readonly<Record<string, { kind: "v" | "c"; message: string }>> = {
  "verse-without-designator": {
    kind: "v",
    message: "Either type a verse number here, or remove the verse marker.",
  },
  "chapter-without-designator": {
    kind: "c",
    message: "Either type a chapter number here, or remove the chapter marker.",
  },
};

const slotAt = (
  state: EditorState,
  kind: "v" | "c",
  from: number,
  to: number,
):
  | { readonly from: number; readonly to: number; readonly marker: { from: number; to: number } }
  | undefined => {
  const structure = structureAt(state);
  const at = (markerFrom: number, place: number) => {
    const spaced = state.doc.sliceString(place, place + 1) === " ";
    const end = spaced ? place + 1 : place;
    return { from: place, to: end, marker: { from: markerFrom, to: end } };
  };
  if (kind === "v") {
    const verse = structure.verses.find((row) => row.markerFrom >= from && row.markerFrom <= to);
    return verse === undefined ? undefined : at(verse.markerFrom, verse.contentFrom);
  }
  for (const line of structure.lines)
    if (line.from >= from && line.from <= to) return at(line.from, line.contentFrom);
  return undefined;
};

const SLOT_FIX_LABEL: Readonly<Record<"v" | "c", string>> = {
  v: "remove the verse marker",
  c: "remove the chapter marker",
};

export type HiddenTest = (state: EditorState, from: number, to: number) => boolean;

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
    const name = diagnosticName(f);
    const asSlot = SLOT_FINDINGS[name];
    const slot = asSlot === undefined ? undefined : slotAt(state, asSlot.kind, at.from, at.to);
    out.push({
      code: f.code().code,
      name,
      severity,
      from: slot?.from ?? at.from,
      to: slot?.to ?? at.to,
      second: f.second(),
      message:
        slot !== undefined && asSlot !== undefined ? asSlot.message : diagnosticMessage(f, slice),
      fixLabel:
        slot !== undefined && asSlot !== undefined && f.fix() === null
          ? SLOT_FIX_LABEL[asSlot.kind]
          : diagnosticFixLabel(f),
      fix:
        slot !== undefined && f.fix() === null
          ? [{ from: slot.marker.from, to: slot.marker.to, insert: "" }]
          : f.fix(),
      hidden: slot === undefined && isHidden ? isHidden(state, at.from, at.to) : false,
      point: slot !== undefined,
      line: state.doc.lineAt(Math.min(at.from, state.doc.length)).number,
      stamp,
    });
  }
  done();
  const places = out.filter((f) => f.point);
  return places.length === 0
    ? out
    : out.filter(
        (f) =>
          f.name !== "delimiter-surplus" ||
          !places.some((p) => f.from <= p.to + 1 && f.to >= p.from - 1),
      );
}

function applyFix(
  view: EditorView,
  fix: { from: number; to: number; insert: string }[],
  stamp?: EngineStamp,
): boolean {
  if (
    stamp !== undefined &&
    !stampMatches(stamp, analyzed(view.state.facet(analyzer), view.state.doc.toString()))
  ) {
    reportOutcome("editor.fix", "declined", "the document moved under it", {
      "fix.edits": fix.length,
    });
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
  /**
   * Buttons in the finding's popup, the host's own: a suppression's "Fine
   * here", say. The package draws them and calls `run`; what they do is the
   * host's business.
   */
  readonly actions?: readonly CorpusAction[];
}

export interface CorpusAction {
  readonly name: string;
  readonly run: () => void;
}

const NO_CORPUS: readonly CorpusFinding[] = [];

const setCorpusFindings = StateEffect.define<readonly CorpusFinding[]>();

const sousField = StateField.define<readonly CorpusFinding[]>({
  create: () => NO_CORPUS,
  update(held, tr) {
    for (const effect of tr.effects) if (effect.is(setCorpusFindings)) return effect.value;
    return tr.docChanged ? carryForward(held, tr.changes) : held;
  },
});

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

function onionDiagnostics(
  state: EditorState,
  isHidden: HiddenTest,
  suppressHidden: () => boolean,
): CmDiagnostic[] {
  const out: CmDiagnostic[] = [];
  const verses = structureAt(state).verses;
  for (const f of findings(state, isHidden)) {
    if (f.severity === null) continue;
    if (f.hidden && suppressHidden()) continue;
    const fix = f.fix;
    const stamp = f.stamp;
    const diagnostic: CmDiagnostic = {
      from: f.from,
      to: f.point ? f.to : Math.max(f.to, f.from + 1),
      severity: f.severity,
      source: `onion/${f.name}`,
      markClass: f.point ? "usfm-lint-slot" : (SEVERITY_CLASS[f.severity] ?? "usfm-lint-info"),
      message: f.message,
      actions:
        fix === null
          ? undefined
          : [
              {
                name: `Fix: ${f.fixLabel ?? "repair"}`,
                markClass: "usfm-fix-action",
                apply(target) {
                  applyFix(target, fix, stamp);
                },
              },
            ],
    };
    const only = fix?.length === 1 ? fix[0] : undefined;
    const verse =
      only === undefined
        ? undefined
        : verses.find((row) => row.numFrom === only.from && row.numTo === only.to);
    if (verse !== undefined && only !== undefined && /^\d/.test(only.insert))
      suggestedNumber.set(diagnostic, only.insert);
    if (
      only !== undefined &&
      only.insert === "" &&
      verses.some((row) => row.markerFrom === only.from)
    )
      removesMarker.set(diagnostic, { from: only.from, to: only.to });
    out.push(diagnostic);
  }
  return out;
}

function corpusDiagnostics(
  state: EditorState,
  isHidden: HiddenTest,
  suppressHidden: () => boolean,
): CmDiagnostic[] {
  const out: CmDiagnostic[] = [];
  const length = state.doc.length;
  for (const f of corpusFindings(state)) {
    if (f.from < 0 || f.to > length || f.from > f.to) continue;
    if (suppressHidden() && isHidden(state, f.from, f.to)) continue;
    out.push({
      from: f.from,
      to: Math.max(f.to, Math.min(f.from + 1, length)),
      severity: f.severity,
      source: `sous/${f.code}`,
      markClass: SEVERITY_CLASS[f.severity] ?? "usfm-lint-info",
      message: f.message,
      actions: f.actions?.map((action) => ({
        name: action.name,
        apply: () => action.run(),
      })),
    });
  }
  return out;
}

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
        return [
          ...onionDiagnostics(view.state, isHidden, suppressHidden),
          ...corpusDiagnostics(view.state, isHidden, suppressHidden),
        ];
      },
      {
        delay: 150,
        tooltipFilter: leaveNumbersToTheMenu,
        needsRefresh: (update) =>
          update.state.field(sousField, false) !== update.startState.field(sousField, false) ||
          update.transactions.some((tr) => tr.reconfigured),
      },
    ),
  ];
}
