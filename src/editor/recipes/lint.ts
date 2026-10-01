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
import { reportOutcome } from "../core/instrument";
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
  /** Moved onto an empty number's place (`SLOT_FINDINGS`): the space after its box. */
  point: boolean;
  line: number;
  stamp: EngineStamp;
}

/**
 * Findings drawn where the reader can act on them, not dropped as hidden: an
 * empty verse or chapter number. Its marker is hidden in regular mode, so the
 * finding's span is too, and the default hidden test would drop it — leaving an
 * empty number the reader can neither see flagged nor explain. So these are a
 * named exception by default: the finding becomes a point at the empty number's
 * box, and the Fix is the engine's own removal of the marker.
 *
 * The wording is Sefer's until kitchen's catalogue carries it; it moves there
 * with the copy and i18n pass.
 */
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

/**
 * An empty number's place for a marker inside `[from, to]`: where the number
 * goes (the box, where its content starts), the one space after it that is the
 * finding's underline, and the whole marker as the Fix removes it — `\v` and
 * the space that was its number's delimiter, as Backspace at the box does.
 */
const slotAt = (
  state: EditorState,
  kind: "v" | "c",
  from: number,
  to: number,
):
  | { readonly from: number; readonly to: number; readonly marker: { from: number; to: number } }
  | undefined => {
  const s = structureAt(state);
  const at = (markerFrom: number, place: number) => {
    const spaced = state.doc.sliceString(place, place + 1) === " ";
    const end = spaced ? place + 1 : place;
    return { from: place, to: end, marker: { from: markerFrom, to: end } };
  };
  if (kind === "v") {
    const v = s.verses.find((row) => row.markerFrom >= from && row.markerFrom <= to);
    return v === undefined ? undefined : at(v.markerFrom, v.contentFrom);
  }
  for (const line of s.lines)
    if (line.from >= from && line.from <= to) return at(line.from, line.contentFrom);
  return undefined;
};

/** What the Fix says when the engine offers none for an empty number. */
const SLOT_FIX_LABEL: Readonly<Record<"v" | "c", string>> = {
  v: "remove the verse marker",
  c: "remove the chapter marker",
};

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
      // The engine's own fix when it offers one; for an empty number with none,
      // the deliberate delete itself: the marker and its space.
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
  // An empty number's forced space is its delimiter-to-be, not surplus: the
  // engine's "reducible whitespace" there would offer to delete it and turn
  // `\v  the` into `\v the`, verse "the". Dropped where it touches an empty
  // number's place.
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
  // A fix carries the stamp of the text it was computed from. Re-analysing the
  // live document is the cheap way to prove it still describes this text — the
  // engine's own hash, not a length, so an equal-length edit under the
  // tooltip is caught.
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
            // A slot finding covers the one space after the empty number's box,
            // so hovering the box reaches it; it draws nothing (`usfm-lint-slot`).
            to: f.point ? f.to : Math.max(f.to, f.from + 1),
            severity: f.severity,
            source: `onion/${f.name}`,
            // An empty number's finding draws nothing of its own: the box is
            // the mark, and the range only keeps the hover and the Fix on it.
            markClass: f.point
              ? "usfm-lint-slot"
              : (SEVERITY_CLASS[f.severity] ?? "usfm-lint-info"),
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
