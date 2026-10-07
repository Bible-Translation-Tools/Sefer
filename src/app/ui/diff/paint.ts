/**
 * The engine's diff as paint: what `#editor` `mountDiffView` draws on a text,
 * worked out from decision units. Shared by `/review` and the playground's diff
 * experiments, so every surface paints a change the same way.
 *
 * Nothing here reads USFM: units and word runs are `galley.diff`'s, with spans
 * into each side's own document; `readingEnd` (core/excerpts) trims a tint to
 * where the reading stops.
 */

import { readingEnd } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import { unitReference, type DecisionUnit, type MergeSide } from "#core/galley/diff";
import type { DiffHunk, DiffPaint } from "#editor/index";

export type Side = "baseline" | "current";

export const changed = (unit: DecisionUnit): boolean => unit.status !== "unchanged";

const tint = (
  unit: DecisionUnit,
  decision: MergeSide | undefined,
  live: boolean,
  marked: boolean,
): string =>
  // When decisions are WRITTEN (an editable review), the diff is the truth: a taken
  // unit that was edited afterwards differs again and is drawn as a change,
  // red and green like any other. The decision tint marks only a unit that
  // reads exactly as the side it was decided for.
  live && changed(unit)
    ? statusTint(unit, marked)
    : decision === "current"
      ? "cm-diff-kept"
      : decision === "baseline"
        ? "cm-diff-taken"
        : statusTint(unit, marked);

/**
 * A changed verse whose words are marked gets no wash: the marks say where it
 * changed, and a faint tint under them said nothing more. One with nothing to
 * mark in this projection — markup changed, markup hidden — gets the markup
 * wash, or it would not show at all. `""` is no line.
 */
const statusTint = (unit: DecisionUnit, marked: boolean): string =>
  unit.status === "added"
    ? "cm-diff-added-unit"
    : unit.status === "deleted"
      ? "cm-diff-deleted-unit"
      : unit.isUsfmStructureChange || !marked
        ? "cm-diff-markup-unit"
        : "";

/** Does either side of a changed unit have a word run to mark in this projection? */
const marksWords = (unit: DecisionUnit, usfm: boolean): boolean =>
  [...(unit.text?.baseline ?? []), ...(unit.text?.current ?? [])].some(
    (run) => run.kind !== "unchanged" && visibleRun(run.what, usfm),
  );

/**
 * Runs worth marking in this projection: words and whitespace always —
 * spaces typed between two sentences are a change a reader has to see, and
 * leaving them unmarked left a gap nothing explained — markup only when
 * markup is shown.
 */
const visibleRun = (what: string, usfm: boolean): boolean => what !== "markup" || usfm;

/**
 * A unit's decision, in the gutter: keep the `current` side's text, or take the
 * `baseline` side's. Pressing the chosen one again clears it, so there are
 * three states and two buttons, as on every decision in Sefer.
 *
 * `decision` is read while painting and names the tint: a decided unit stops
 * shouting. What a decision DOES is the caller's — `/review` edits its map and
 * writes nothing until Apply; the playground merges at once.
 */
export interface Controls {
  readonly decision: (unit: DecisionUnit) => MergeSide | undefined;
  readonly decide: (unit: DecisionUnit, side: MergeSide | undefined) => void;
  /** What the two buttons say on hover: "Keep the editor's", "Take the file's". */
  readonly keepTitle: string;
  readonly takeTitle: string;
  /** Decisions are written as they are made, so the diff, not the decision, names the tint. */
  readonly live?: boolean;
  /**
   * Whether each unit gets its pair of buttons in the gutter. Off on a card,
   * whose header already decides it — two of the same choice, side by side,
   * was one too many.
   */
  readonly gutter?: boolean;
}

/** A chevron pointing at the side it chooses: left takes the other side's, right keeps yours. */
const chevron = (points: "left" | "right"): SVGSVGElement => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", points === "left" ? "M15 5 L8 12 L15 19" : "M9 5 L16 12 L9 19");
  svg.append(path);
  return svg;
};

const button = (
  unit: DecisionUnit,
  controls: Controls,
  side: MergeSide,
  title: string,
): HTMLButtonElement => {
  const on = controls.decision(unit) === side;
  const element = document.createElement("button");
  element.type = "button";
  element.title = title;
  element.append(chevron(side === "baseline" ? "left" : "right"));
  element.dataset["on"] = on ? "true" : "false";
  element.dataset["side"] = side;
  element.setAttribute("aria-pressed", on ? "true" : "false");
  element.setAttribute("aria-label", title);
  element.onclick = () => controls.decide(unit, on ? undefined : side);
  return element;
};

const controlFor =
  (unit: DecisionUnit, controls: Controls): (() => HTMLElement) =>
  () => {
    const box = document.createElement("span");
    box.className = "cm-diff-control";
    box.dataset["unit"] = unit.id;
    // Which verse this pair decides: two verses can start on one line, and an
    // unlabelled pair could be either's. "9", "5-7"; a heading keeps its whole
    // reference.
    const reference = unitReference(unit);
    const ref = document.createElement("span");
    ref.className = "cm-diff-control-ref";
    ref.textContent = reference.slice(reference.indexOf(":") + 1);
    // Between the two texts, the other side's on the left and yours on the
    // right: each chevron points at the text it chooses, and the verse it
    // decides sits between them.
    box.append(
      button(unit, controls, "baseline", controls.takeTitle),
      ref,
      button(unit, controls, "current", controls.keepTitle),
    );
    return box;
  };

/** One side of a split: tints, and the words that side has and the other does not. */
export const sidePaint = (
  units: readonly DecisionUnit[],
  side: Side,
  usfm: boolean,
  controls: Controls | undefined,
  analysis: Analysis,
): DiffPaint => {
  const lines: DiffPaint["lines"][number][] = [];
  const marks: DiffPaint["marks"][number][] = [];
  const buttons: DiffPaint["controls"][number][] = [];
  for (const unit of units) {
    const span = side === "baseline" ? unit.baseline : unit.current;
    const decision = controls?.decision(unit);
    // An unchanged unit is painted only when it carries a decision: in the
    // an editable review a taken unit IS the other side's text now, and
    // still has to say so — and keep its control, to put it back.
    if (!changed(unit) && decision === undefined) continue;
    if (span !== undefined) {
      // To where the reading ends, not the structural end: a unit's span runs
      // to the next unit's marker, so it owns the bare `\q1` before the next
      // verse — and in regular mode that hidden line is drawn as the next
      // verse's line, which the tint would then claim.
      const end = usfm ? span.to : readingEnd(analysis, span.from, span.to);
      // Either side's marks count: a verse that only lost words is marked in
      // the baseline pane, and the current pane's text beside it is enough.
      const line = tint(unit, decision, controls?.live === true, marksWords(unit, usfm));
      if (line !== "")
        lines.push({ from: span.from, to: Math.max(span.from + 1, end), class: line });
      // Word marks only where there is something to compare: a unit only one
      // side has is ALL change, and marking each of its words says nothing
      // the tint has not.
      const runs =
        unit.status !== "modified"
          ? undefined
          : side === "baseline"
            ? unit.text?.baseline
            : unit.text?.current;
      for (const run of runs ?? [])
        if (run.kind !== "unchanged" && visibleRun(run.what, usfm))
          marks.push({
            from: run.from,
            to: run.to,
            class: side === "baseline" ? "cm-diff-removed" : "cm-diff-added",
          });
    }
    if (controls !== undefined && controls.gutter !== false && side === "current")
      buttons.push({
        at: span?.from ?? unit.place[side],
        key: `${unit.id} ${decision ?? "-"}`,
        render: controlFor(unit, controls),
      });
  }
  return { lines, marks, controls: buttons };
};

/**
 * The working text as a Zed diff: nothing on the text until a unit is opened;
 * a bar per changed unit beside its own rows. Opening one tints it, marks the
 * words it added, and opens the other side's wording at it (`was`) with the
 * words it removed marked there. What is reviewed is the final text; the
 * change is there when asked for, and the text being edited carries no struck
 * words.
 */
export const hunkPaint = (
  units: readonly DecisionUnit[],
  usfm: boolean,
  controls: Controls | undefined,
  was: (unit: DecisionUnit) => HTMLElement,
  analysis: Analysis,
): DiffPaint => {
  const base = sidePaint(units, "current", usfm, controls, analysis);
  const hunks: DiffHunk[] = [];
  for (const unit of units) {
    const span = unit.current;
    const decision = controls?.decision(unit);
    if (!changed(unit) && decision === undefined) continue;
    if (span === undefined) {
      hunks.push({
        key: unit.id,
        kind: "deleted",
        from: unit.place.current,
        to: unit.place.current,
        tint: "",
        marks: [],
        old: () => was(unit),
        label: `Removed ${unitReference(unit)}`,
      });
      continue;
    }
    const end = usfm ? span.to : readingEnd(analysis, span.from, span.to);
    const runs = unit.status === "modified" ? (unit.text?.current ?? []) : [];
    hunks.push({
      key: unit.id,
      kind: !changed(unit) ? "decided" : unit.status === "added" ? "added" : "modified",
      from: span.from,
      to: Math.max(span.from + 1, end),
      // Open: the verse as it reads now, green beside the red of what it was.
      tint: changed(unit) ? "cm-diff-now" : tint(unit, decision, controls?.live === true, true),
      marks: runs
        .filter((run) => run.kind !== "unchanged" && visibleRun(run.what, usfm))
        .map((run) => ({ from: run.from, to: run.to, class: "cm-diff-added" })),
      old: unit.baseline === undefined || !changed(unit) ? undefined : () => was(unit),
      label: `${!changed(unit) ? "Decided" : unit.status === "added" ? "Added" : "Changed"} ${unitReference(unit)}`,
    });
  }
  return { lines: [], marks: [], controls: base.controls, hunks };
};
