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

/**
 * How a change is COLOURED, and why there are two answers.
 *
 * `side` is what `/review` does today, and the reasoning is in `UnitCard.tsx`:
 * red/green is a judgement. It says one side is a deletion and the other an
 * addition, which is true of a diff against your own past and false of a
 * comparison between two people's work — so the tint is by SIDE, brand for one
 * and neutral for the other, and neither is coloured like a mistake.
 *
 * `wasNow` is the classic, and it is here because that argument only holds for
 * the comparison case. Reviewing your own edits IS a was/now, everybody who has
 * used a diff already reads red as gone and green as new, and refusing them
 * that because of a case they are not in is the tool being clever at them.
 *
 * Both keep the non-colour channel — removed text is struck through, added text
 * is underlined — so neither depends on hue alone. That is what makes this a
 * preference rather than an accessibility hazard: the meaning survives with the
 * colour turned off, and a reader who cannot separate red from green reads the
 * same page from the strike and the rule.
 *
 * LIKELY A SETTING, not a dial, once it settles: it is a property of the reader,
 * not of the screen, so it belongs beside the other reading preferences rather
 * than on each diff surface.
 */
export type DiffTone = "side" | "wasNow";

const RUN_TONE: Record<DiffTone, Record<TextRun["kind"], string>> = {
  side: {
    unchanged: "",
    // Struck through rather than tinted: a deletion in a document you are
    // reading is a word with a line through it, and it stays legible.
    removed: "line-through decoration-2 decoration-on-surface-tertiary text-on-surface-tertiary",
    added: "rounded-[2px] bg-brand-light text-brand-strong",
  },
  wasNow: {
    unchanged: "",
    removed:
      "rounded-[2px] bg-surface-error text-on-surface-error line-through decoration-2 decoration-on-surface-error/60",
    added: "rounded-[2px] bg-surface-success text-on-surface-success underline decoration-1",
  },
};

export const Runs = (props: { readonly runs: readonly TextRun[]; readonly tone: DiffTone }) => (
  <For each={props.runs}>
    {(run) => (
      <span data-run={run.kind} class={RUN_TONE[props.tone][run.kind]}>
        {run.text}
      </span>
    )}
  </For>
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
export const Merged = (props: { readonly unit: DecisionUnit; readonly tone: DiffTone }) => {
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

  return <Runs runs={runs()} tone={props.tone} />;
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
 * The tone a WHOLE side carries when there are no runs to mark.
 *
 * A one-sided unit — a verse the draft has and the editor does not, or the
 * reverse — has no intra-unit diff, because there is nothing to diff it
 * against. Every character of it is the change. Marking only the runs therefore
 * leaves the most drastic units on the page as the only unmarked ones, which is
 * exactly backwards and is what made the first pass read as toneless.
 */
const WHOLE: Record<DiffTone, Record<"was" | "now", string>> = {
  side: {
    was: "text-on-surface-tertiary line-through decoration-1",
    now: "rounded-[2px] bg-brand-light px-0.5 text-brand-strong",
  },
  wasNow: {
    was: "rounded-[2px] bg-surface-error px-0.5 text-on-surface-error line-through decoration-1",
    now: "rounded-[2px] bg-surface-success px-0.5 text-on-surface-success",
  },
};

/** No unit on this side at all — said in words, because blank is ambiguous. */
const Absent = () => (
  <span class="text-smallest text-on-surface-tertiary italic">nothing on this side</span>
);

/**
 * One unit's body, in whichever of the two readings the layout asked for.
 *
 * `merged` is the tracked-changes paragraph; `split` is the two columns, whose
 * rows line up by construction because a row IS a reference — see the note in
 * `experiments/continuous.tsx`.
 *
 * Three cases, and the third is the one that is easy to forget: a unit with
 * runs is marked word by word, an unchanged unit is plain reading text, and a
 * ONE-SIDED unit is tinted whole and says "nothing on this side" opposite it.
 */
export const UnitBody = (props: {
  readonly bench: Bench;
  readonly unit: DecisionUnit;
  readonly split: boolean;
  readonly tone: DiffTone;
}) => {
  /**
   * One side's reading text, or `undefined` when there is none to show.
   *
   * Emptiness and absence are collapsed here ON PURPOSE, and only here. The
   * engine reports a one-sided unit by a null RANGE, but it also emits a
   * zero-width range for a side that exists and holds nothing — and to a reader
   * looking at a column those are the same fact: there is no text here. The
   * distinction that matters ("is the verse missing, or is it empty") is
   * carried by `status`, which is what decides whether the column says so.
   */
  const side = (which: MergeSide): string | undefined => {
    const text = sideText(props.bench, props.unit, which);
    return text === undefined || text.trim() === "" ? undefined : text;
  };

  /**
   * This side's word runs, or `undefined` when there are none.
   *
   * A one-sided unit still carries a `text`: the engine emits runs for the side
   * that exists and an EMPTY list for the side that does not. So "has runs" is
   * `length > 0`, not `text !== undefined` — reading it the other way is what
   * left the empty column silent instead of saying it was empty.
   */
  const runsFor = (which: MergeSide): readonly TextRun[] | undefined => {
    const text = props.unit.text;
    if (text === undefined) return undefined;
    const runs = which === "baseline" ? text.baseline : text.current;
    return runs.length === 0 ? undefined : runs;
  };

  /** The side a one-sided unit actually lives on, so it can be tinted whole. */
  const onlyOn = (): MergeSide | undefined => {
    if (props.unit.status === "unchanged") return undefined;
    const hasBaseline = runsFor("baseline") !== undefined || side("baseline") !== undefined;
    const hasCurrent = runsFor("current") !== undefined || side("current") !== undefined;
    if (hasBaseline && !hasCurrent) return "baseline";
    if (hasCurrent && !hasBaseline) return "current";
    return undefined;
  };

  const whole = (which: MergeSide): string =>
    onlyOn() === which ? WHOLE[props.tone][which === "baseline" ? "was" : "now"] : "";

  /** A column: the marked runs, the tinted whole, or the absence. */
  const Column = (columnProps: { readonly which: MergeSide }) => (
    <Show
      when={runsFor(columnProps.which)}
      fallback={
        <Show
          when={side(columnProps.which)}
          fallback={
            // Only a CHANGED unit's empty column is an absence worth saying.
            // A chapter heading is empty on both sides and always was.
            <Show when={props.unit.status !== "unchanged"}>
              <Absent />
            </Show>
          }
        >
          {(text) => <span class={whole(columnProps.which)}>{text()}</span>}
        </Show>
      }
    >
      {(runs) => <Runs runs={runs()} tone={props.tone} />}
    </Show>
  );

  return (
    <Show
      when={props.split}
      fallback={
        <p class="text-small leading-relaxed text-on-surface-primary">
          <Show
            when={onlyOn() === undefined ? props.unit.text : undefined}
            fallback={
              <Show when={onlyOn()} fallback={side("current") ?? side("baseline")}>
                {(only) => <span class={whole(only())}>{side(only())}</span>}
              </Show>
            }
          >
            <Merged unit={props.unit} tone={props.tone} />
          </Show>
        </p>
      }
    >
      <div class="grid grid-cols-2 gap-4">
        <p class="text-small leading-relaxed text-on-surface-secondary">
          <Column which="baseline" />
        </p>
        <p class="text-small leading-relaxed text-on-surface-primary">
          <Column which="current" />
        </p>
      </div>
    </Show>
  );
};
