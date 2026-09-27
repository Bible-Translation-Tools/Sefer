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
import type { DecisionUnit, DiffSkeleton, MergeSide } from "#core/galley/diff";
import type { DiffPaint, DiffWidget } from "#editor/index";

export type Side = "baseline" | "current";

/** Units in the engine's own interleave order — what both panes are read in. */
export const ordered = (skeleton: DiffSkeleton): readonly DecisionUnit[] => {
  const rows: DecisionUnit[] = [];
  let last = -1;
  for (const slot of skeleton.slots) {
    if (slot.unit === last) continue;
    last = slot.unit;
    const unit = skeleton.units[slot.unit];
    if (unit !== undefined) rows.push(unit);
  }
  return rows.length > 0 ? rows : [...skeleton.units];
};

export const changed = (unit: DecisionUnit): boolean => unit.status !== "unchanged";

const tint = (unit: DecisionUnit, decision: MergeSide | undefined): string =>
  decision === "current"
    ? "cm-diff-kept"
    : decision === "baseline"
      ? "cm-diff-taken"
      : unit.status === "added"
        ? "cm-diff-added-unit"
        : unit.status === "deleted"
          ? "cm-diff-deleted-unit"
          : unit.isUsfmStructureChange
            ? "cm-diff-markup-unit"
            : "cm-diff-modified-unit";

/** Word runs worth marking in this projection: markup only when markup is shown. */
const visibleRun = (what: string, usfm: boolean): boolean =>
  what === "text" || (usfm && what === "markup");

const inline = (text: string, name: string): HTMLElement => {
  const span = document.createElement("span");
  span.className = name;
  span.textContent = text.replace(/\s+/g, " ");
  return span;
};

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
}

const button = (
  unit: DecisionUnit,
  controls: Controls,
  side: MergeSide,
  glyph: string,
  title: string,
): HTMLButtonElement => {
  const on = controls.decision(unit) === side;
  const element = document.createElement("button");
  element.type = "button";
  element.title = title;
  element.textContent = glyph;
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
    box.append(
      button(unit, controls, "current", "✓", controls.keepTitle),
      button(unit, controls, "baseline", "↶", controls.takeTitle),
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
  /** Where this side's text stands before the first unit — for a list that starts mid-book. */
  startAt = 0,
): DiffPaint => {
  const lines: DiffPaint["lines"][number][] = [];
  const marks: DiffPaint["marks"][number][] = [];
  const widgets: DiffWidget[] = [];
  const buttons: DiffPaint["controls"][number][] = [];
  let lastEnd = startAt;
  for (const unit of units) {
    const span = side === "baseline" ? unit.baseline : unit.current;
    if (span !== undefined) lastEnd = span.to;
    const decision = controls?.decision(unit);
    // An unchanged unit is painted only when it carries a decision: in the
    // review's Result mode a taken unit IS the other side's text now, and
    // still has to say so — and keep its control, to put it back.
    if (!changed(unit) && decision === undefined) continue;
    if (span !== undefined) {
      // To where the reading ends, not the structural end: a unit's span runs
      // to the next unit's marker, so it owns the bare `\q1` before the next
      // verse — and in regular mode that hidden line is drawn as the next
      // verse's line, which the tint would then claim.
      const end = usfm ? span.to : readingEnd(analysis, span.from, span.to);
      lines.push({
        from: span.from,
        to: Math.max(span.from + 1, end),
        class: tint(unit, decision),
      });
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
    if (controls !== undefined && side === "current")
      buttons.push({
        at: span?.from ?? lastEnd,
        key: `${unit.id} ${decision ?? "-"}`,
        render: controlFor(unit, controls),
      });
  }
  return { lines, marks, widgets, controls: buttons };
};

/**
 * The working text with the earlier one folded into it: removed words where
 * they were, a removed unit where it stood.
 */
export const unifiedPaint = (
  units: readonly DecisionUnit[],
  usfm: boolean,
  controls: Controls | undefined,
  removedBlock: (unit: DecisionUnit) => HTMLElement,
  analysis: Analysis,
  startAt = 0,
): DiffPaint => {
  const base = sidePaint(units, "current", usfm, controls, analysis, startAt);
  const widgets: DiffWidget[] = [];
  let lastEnd = startAt;
  for (const unit of units) {
    if (unit.current !== undefined) lastEnd = unit.current.to;
    if (!changed(unit)) continue;
    if (unit.current === undefined) {
      widgets.push({
        at: lastEnd,
        block: true,
        key: `gone ${unit.id}`,
        render: () => removedBlock(unit),
      });
      continue;
    }
    const was = unit.text?.baseline ?? [];
    const now = unit.text?.current ?? [];
    // Both sides list their unchanged runs in the same order, so walking them
    // together places each stretch of removed runs just before what replaced
    // it, or just after the last WORD the two share — not after a shared
    // newline or bare `\q1`, which in regular mode is the next verse's line.
    let at = 0;
    let wordEnd = unit.current.from;
    let held: { text: string; from: number } | undefined;
    const flush = (): void => {
      if (held === undefined || held.text.trim() === "") {
        held = undefined;
        return;
      }
      const next = now[at];
      const place = next !== undefined && next.kind === "added" ? next.from : wordEnd;
      const stretch = held;
      widgets.push({
        at: place,
        block: false,
        key: `was ${unit.id} ${stretch.from}`,
        render: () => inline(stretch.text, "cm-diff-struck"),
      });
      held = undefined;
    };
    for (const run of was) {
      if (run.kind === "unchanged") {
        flush();
        while (at < now.length && now[at]?.kind !== "unchanged") {
          const skipped = now[at];
          if (skipped?.what === "text") wordEnd = skipped.to;
          at += 1;
        }
        const shared = now[at];
        if (shared?.what === "text") wordEnd = shared.to;
        at += 1;
        continue;
      }
      // Whitespace joins a stretch (so struck words keep their spaces);
      // markup joins it only where markup is shown.
      if (run.what === "markup" && !usfm) continue;
      held =
        held === undefined
          ? { text: run.text, from: run.from }
          : { ...held, text: held.text + run.text };
    }
    flush();
  }
  return { ...base, widgets: [...base.widgets, ...widgets] };
};
