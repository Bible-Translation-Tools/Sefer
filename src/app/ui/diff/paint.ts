import type { DiffHunk, DiffPaint } from "@sefer/editor";

import { readingEnd } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import { unitReference, type DecisionUnit, type MergeSide } from "#core/galley/diff";

export type Side = "baseline" | "current";

export const changed = (unit: DecisionUnit): boolean => unit.status !== "unchanged";

const tint = (
  unit: DecisionUnit,
  decision: MergeSide | undefined,
  live: boolean,
  marked: boolean,
): string =>
  live && changed(unit) ? statusTint(unit, marked) : decidedTint(decision, unit, marked);

const modifiedRuns = (unit: DecisionUnit, side: Side) => {
  if (unit.status !== "modified") return undefined;
  return side === "baseline" ? unit.text?.baseline : unit.text?.current;
};

const hunkKind = (unit: DecisionUnit): "decided" | "added" | "modified" => {
  if (!changed(unit)) return "decided";
  return unit.status === "added" ? "added" : "modified";
};

const hunkVerb = (unit: DecisionUnit): string => {
  if (!changed(unit)) return "Decided";
  return unit.status === "added" ? "Added" : "Changed";
};

const decidedTint = (
  decision: MergeSide | undefined,
  unit: DecisionUnit,
  marked: boolean,
): string => {
  if (decision === "current") return "cm-diff-kept";
  if (decision === "baseline") return "cm-diff-taken";
  return statusTint(unit, marked);
};

const statusTint = (unit: DecisionUnit, marked: boolean): string => {
  if (unit.status === "added") return "cm-diff-added-unit";
  if (unit.status === "deleted") return "cm-diff-deleted-unit";
  return unit.isUsfmStructureChange || !marked ? "cm-diff-markup-unit" : "";
};

const marksWords = (unit: DecisionUnit, usfm: boolean): boolean =>
  [...(unit.text?.baseline ?? []), ...(unit.text?.current ?? [])].some(
    (run) => run.kind !== "unchanged" && visibleRun(run.what, usfm),
  );

const visibleRun = (what: string, usfm: boolean): boolean => what !== "markup" || usfm;

export interface Controls {
  readonly decision: (unit: DecisionUnit) => MergeSide | undefined;
  readonly decide: (unit: DecisionUnit, side: MergeSide | undefined) => void;
  readonly keepTitle: string;
  readonly takeTitle: string;
  readonly live?: boolean;
  readonly gutter?: boolean;
  readonly dimUnchosen?: boolean;
}

const chevron = (points: "left" | "right"): SVGSVGElement => {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNamespace, "path");
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
    const reference = unitReference(unit);
    const ref = document.createElement("span");
    ref.className = "cm-diff-control-ref";
    ref.textContent = reference.slice(reference.indexOf(":") + 1);
    box.append(
      button(unit, controls, "baseline", controls.takeTitle),
      ref,
      button(unit, controls, "current", controls.keepTitle),
    );
    return box;
  };

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
    if (!changed(unit) && decision === undefined) continue;
    if (span !== undefined) {
      const end = usfm ? span.to : readingEnd(analysis, span.from, span.to);
      const unchosen =
        controls?.dimUnchosen === true &&
        decision !== undefined &&
        (controls.live === true ? side === "baseline" : decision !== side);
      const line = unchosen
        ? "cm-diff-unchosen"
        : tint(unit, decision, controls?.live === true, marksWords(unit, usfm));
      if (line !== "")
        lines.push({ from: span.from, to: Math.max(span.from + 1, end), class: line });
      const runs = modifiedRuns(unit, side);
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
      kind: hunkKind(unit),
      from: span.from,
      to: Math.max(span.from + 1, end),
      tint: changed(unit) ? "cm-diff-now" : tint(unit, decision, controls?.live === true, true),
      marks: runs
        .filter((run) => run.kind !== "unchanged" && visibleRun(run.what, usfm))
        .map((run) => ({ from: run.from, to: run.to, class: "cm-diff-added" })),
      old: unit.baseline === undefined || !changed(unit) ? undefined : () => was(unit),
      label: `${hunkVerb(unit)} ${unitReference(unit)}`,
    });
  }
  return { lines: [], marks: [], controls: base.controls, hunks };
};
