import { For, Show, createMemo } from "solid-js";

import { cx } from "#app/ui/primitives";
import { textOf } from "#app/ui/review/reading";
import { readingRuns, type DecisionUnit, type MergeSide, type TextRun } from "#core/galley/diff";

import type { Bench } from "./experiment";

export const inOrder = (bench: Bench): readonly DecisionUnit[] => bench.skeleton?.units ?? [];

const sideText = (bench: Bench, unit: DecisionUnit, side: MergeSide): string | undefined =>
  side === "baseline"
    ? textOf(bench.galley, bench.baselineText, unit.baseline, false)
    : textOf(bench.galley, bench.currentText, unit.current, false);

export type DiffTone = "side" | "wasNow";

const RUN_TONE: Record<DiffTone, Record<TextRun["kind"], string>> = {
  side: {
    unchanged: "",
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

const Runs = (props: { readonly runs: readonly TextRun[]; readonly tone: DiffTone }) => (
  <For each={props.runs}>
    {(run) => (
      <span data-run={run.kind} class={RUN_TONE[props.tone][run.kind]}>
        {run.text}
      </span>
    )}
  </For>
);

const Merged = (props: { readonly unit: DecisionUnit; readonly tone: DiffTone }) => {
  const runs = createMemo((): readonly TextRun[] => {
    const text = props.unit.text;
    if (text === undefined) return [];
    const baseline = readingRuns(text.baseline);
    const current = readingRuns(text.current);
    const out: TextRun[] = [];
    let left = 0;
    let right = 0;
    while (left < baseline.length || right < current.length) {
      const removed = baseline[left];
      const added = current[right];
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

const sourceOf = (bench: Bench, unit: DecisionUnit, side: MergeSide): string | undefined => {
  const range = side === "baseline" ? unit.baseline : unit.current;
  if (range === undefined) return undefined;
  const text = side === "baseline" ? bench.baselineText : bench.currentText;
  const raw = text.slice(range.from, range.to);
  return raw.trim() === "" ? undefined : raw;
};

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

const Absent = () => (
  <span class="text-smallest text-on-surface-tertiary italic">nothing on this side</span>
);

export const UnitBody = (props: {
  readonly bench: Bench;
  readonly unit: DecisionUnit;
  readonly split: boolean;
  readonly tone: DiffTone;
  readonly markup?: boolean;
}) => {
  const side = (which: MergeSide): string | undefined => {
    const text = sideText(props.bench, props.unit, which);
    return text === undefined || text.trim() === "" ? undefined : text;
  };

  const runsFor = (which: MergeSide): readonly TextRun[] | undefined => {
    const text = props.unit.text;
    if (text === undefined) return undefined;
    const runs = readingRuns(which === "baseline" ? text.baseline : text.current);
    return runs.length === 0 ? undefined : runs;
  };

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

  const Column = (columnProps: { readonly which: MergeSide }) => (
    <Show
      when={runsFor(columnProps.which)}
      fallback={
        <Show
          when={side(columnProps.which)}
          fallback={
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

  const Source = (sourceProps: { readonly which: MergeSide }) => (
    <Show when={sourceOf(props.bench, props.unit, sourceProps.which)} fallback={<Absent />}>
      {(raw) => (
        <code class="block break-words whitespace-pre-wrap font-mono text-smallest text-on-surface-secondary">
          {raw()}
        </code>
      )}
    </Show>
  );

  return (
    <Show
      when={props.markup !== true}
      fallback={
        <Show
          when={props.split}
          fallback={<Source which={props.unit.current === undefined ? "baseline" : "current"} />}
        >
          <div class="grid grid-cols-2 gap-4">
            <Source which="baseline" />
            <Source which="current" />
          </div>
        </Show>
      }
    >
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
    </Show>
  );
};
