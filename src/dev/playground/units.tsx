/**
 * The pieces every diff experiment needs: reading order, one side's text, the
 * word marks, and the gutter the decision lives in.
 *
 * Shared rather than copied because the experiments are meant to differ in
 * LAYOUT and nothing else — if "continuous" and "excerpts" drew their rows two
 * different ways, comparing them would tell you about the drawing rather than
 * about the layout, which is the one thing a playground must not do.
 *
 * Outside `experiments/`, so the registry's glob does not pick it up.
 */

import { For, Show, createMemo } from "solid-js";

import { cx } from "../../app/ui/primitives";
import { textOf } from "../../app/ui/review/reading";
import type { DecisionUnit, MergeSide, TextRun } from "../../core/galley/diff";
import type { Bench } from "./experiment";

/**
 * The units in READING order.
 *
 * Slots are the ordering, not the unit array: a moved unit sits where the
 * interleave put it, and a coalesced pair contributes two slots naming the same
 * unit, which collapse to one row.
 */
export const inOrder = (bench: Bench): readonly DecisionUnit[] => {
  const skeleton = bench.skeleton;
  if (skeleton === undefined) return [];
  const rows: DecisionUnit[] = [];
  let last = -1;
  for (const slot of skeleton.slots) {
    if (slot.unit === last) continue;
    last = slot.unit;
    const unit = skeleton.units[slot.unit];
    if (unit !== undefined) rows.push(unit);
  }
  // A skeleton whose slots said nothing still has its units, and showing them
  // in array order beats showing an empty page.
  return rows.length > 0 ? rows : [...skeleton.units];
};

/** The reader-visible text of one side of a unit, markers projected away. */
export const sideText = (bench: Bench, unit: DecisionUnit, side: MergeSide): string | undefined =>
  side === "baseline"
    ? textOf(bench.galley, bench.baselineText, unit.baseline, false)
    : textOf(bench.galley, bench.currentText, unit.current, false);

const RUN_TONE: Record<TextRun["kind"], string> = {
  unchanged: "",
  // Struck through rather than tinted red: a deletion in a document you are
  // reading is a word with a line through it, and it stays legible.
  removed: "line-through decoration-2 decoration-on-surface-tertiary text-on-surface-tertiary",
  added: "rounded-[2px] bg-brand-light text-brand-strong",
};

export const Runs = (props: { readonly runs: readonly TextRun[] }) => (
  <For each={props.runs}>{(run) => <span class={RUN_TONE[run.kind]}>{run.text}</span>}</For>
);

/**
 * One unit as ONE paragraph, the way tracked changes reads: the words both
 * sides share said once, the removed words struck through where they stood, the
 * added words tinted.
 *
 * The zip works because the two run lists share their `unchanged` runs in
 * order — `baseline` is unchanged + removed, `current` is unchanged + added —
 * so walking both and emitting the shared runs once reconstructs the sentence
 * with both edits inside it.
 */
export const Merged = (props: { readonly unit: DecisionUnit }) => {
  const runs = createMemo((): readonly TextRun[] => {
    const text = props.unit.text;
    if (text === undefined) return [];
    const out: TextRun[] = [];
    let left = 0;
    let right = 0;
    while (left < text.baseline.length || right < text.current.length) {
      const removed = text.baseline[left];
      const added = text.current[right];
      if (removed !== undefined && removed.kind === "removed") {
        out.push(removed);
        left += 1;
      } else if (added !== undefined && added.kind === "added") {
        out.push(added);
        right += 1;
      } else if (removed !== undefined) {
        out.push(removed);
        left += 1;
        right += 1;
      } else if (added !== undefined) {
        out.push(added);
        right += 1;
      }
    }
    return out;
  });

  return <Runs runs={runs()} />;
};

/** The two decision buttons, small enough to live in a margin. */
export const Gutter = (props: {
  readonly held: MergeSide | undefined;
  readonly onPick: (side: MergeSide | undefined) => void;
}) => (
  <div
    data-held={props.held === undefined ? undefined : ""}
    class="flex shrink-0 items-start gap-0.5 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100 data-held:opacity-100"
  >
    <For each={["baseline", "current"] as const}>
      {(side) => (
        <button
          type="button"
          aria-pressed={props.held === side ? "true" : "false"}
          title={side === "baseline" ? "keep the earlier text" : "keep the editor's text"}
          class={cx(
            "h-5 w-5 cursor-pointer rounded border text-smallest leading-none transition-colors",
            props.held === side
              ? "border-brand bg-brand-light font-semibold text-brand"
              : "border-surface-border text-on-surface-tertiary hover:border-brand/40",
          )}
          onClick={() => props.onPick(props.held === side ? undefined : side)}
        >
          {side === "baseline" ? "←" : "→"}
        </button>
      )}
    </For>
  </div>
);

/**
 * One unit's body, in whichever of the two readings the layout asked for.
 *
 * `merged` is the tracked-changes paragraph; `split` is the two columns, whose
 * rows line up by construction because a row IS a reference — see the note in
 * `experiments/continuous.tsx`.
 */
export const UnitBody = (props: {
  readonly bench: Bench;
  readonly unit: DecisionUnit;
  readonly split: boolean;
}) => (
  <Show
    when={props.split}
    fallback={
      <p class="text-small leading-relaxed text-on-surface-primary">
        <Show
          when={props.unit.status !== "unchanged" && props.unit.text !== undefined}
          fallback={
            sideText(props.bench, props.unit, "current") ??
            sideText(props.bench, props.unit, "baseline")
          }
        >
          <Merged unit={props.unit} />
        </Show>
      </p>
    }
  >
    <div class="grid grid-cols-2 gap-4">
      <p class="text-small leading-relaxed text-on-surface-secondary">
        <Show when={props.unit.text} fallback={sideText(props.bench, props.unit, "baseline")}>
          {(text) => <Runs runs={text().baseline} />}
        </Show>
      </p>
      <p class="text-small leading-relaxed text-on-surface-primary">
        <Show when={props.unit.text} fallback={sideText(props.bench, props.unit, "current")}>
          {(text) => <Runs runs={text().current} />}
        </Show>
      </p>
    </div>
  </Show>
);
