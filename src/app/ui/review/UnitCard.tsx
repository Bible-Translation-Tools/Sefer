/**
 * One decision unit, with a side to choose.
 *
 * The unit is Onion's — a verse, a bridge, a chapter's opening matter, the
 * front matter — addressed by a reference rather than by a line range, which is
 * the whole point of moving the review onto the decision-unit shape
 * (`src/core/galley/diff.ts`). A reviewer reads "1:4", not "lines 12–14".
 *
 * The pair of buttons IS the decision map's editor and nothing else: clicking
 * one calls back with `baseline`, `current` or undecided, and the panel above
 * holds the map. Nothing here writes, which is what lets a reader change their
 * mind up to the moment they press Apply. `aria-pressed` rather than a
 * SegmentedControl because there are three states and two buttons: undecided is
 * neither pressed, which a radio group cannot say.
 *
 * ## Neither side is "left", and neither side is wrong
 *
 * The screen says what each source calls itself — "In the editor", "On disk",
 * the zip's own file name — and never "left" and "right". The buttons say what
 * will happen ("Keep the editor's", "Take the file's") rather than which column
 * wins.
 *
 * The colours follow from the same thought, and this is why they are not red
 * and green. Red/green is a judgement: it says one side is a deletion and the
 * other an addition, which is true of a diff against your own past and false of
 * a comparison between two people's work. So the tint is by SIDE — the brand
 * tint for the left, a neutral tint for the right — each with a start-edge rule
 * so the pair still reads for someone who cannot separate the hues.
 */

import { For, Show, createMemo } from "solid-js";

import { hasInlineChange, inlineDiff, sideOf, type InlineSegment } from "../../../core/diff/inline";
import { unitReference, type DecisionUnit, type MergeSide } from "../../../core/galley";
import { t } from "../../i18n";
import { Badge, Button, Card, cx } from "../primitives";

/** Lines shown per side before the block says how many it kept back. */
const MAX_LINES = 24;

const LINE = "flex gap-2 px-2.5 py-px font-mono text-smallest break-words whitespace-pre-wrap";

/**
 * The two side tints. `current` (the left column) is the brand; `baseline` (the
 * right) is neutral. Both carry a start-edge rule so the side is legible
 * without relying on hue alone.
 */
const TINT: Record<MergeSide, string> = {
  current: "bg-brand-light text-on-surface-primary border-s-2 border-brand",
  baseline: "bg-surface-secondary text-on-surface-secondary border-s-2 border-on-surface-tertiary",
};

const MARK: Record<MergeSide, string> = {
  current: "bg-brand/25 text-brand-strong",
  baseline: "bg-on-surface-tertiary/30 text-on-surface-primary",
};

const STATUS_TONE = {
  modified: "warning",
  added: "neutral",
  deleted: "brand",
  moved: "muted",
  unchanged: "muted",
} as const;

const STATUS_LABEL = {
  modified: "changed",
  added: "only in the editor's side",
  deleted: "only in the other side",
  moved: "moved",
  unchanged: "unchanged",
} as const;

/**
 * One side's lines, with the words that differ marked.
 *
 * The segments arrive already computed for the whole unit, so they are split
 * back onto lines here rather than diffed a second time per line — one word
 * diff per unit, however many lines it spans.
 */
const segmentLines = (
  segments: readonly InlineSegment[],
): readonly (readonly InlineSegment[])[] => {
  const out: InlineSegment[][] = [[]];
  for (const segment of segments) {
    const parts = segment.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) out.push([]);
      if (part !== "") out.at(-1)?.push({ kind: segment.kind, text: part });
    });
  }
  if (out.length > 1 && (out.at(-1)?.length ?? 0) === 0) out.pop();
  return out;
};

function Side(props: {
  readonly text: string | undefined;
  readonly marked: readonly (readonly InlineSegment[])[] | undefined;
  readonly side: MergeSide;
  readonly label: string;
  readonly dimmed: boolean;
}) {
  const all = () => props.marked ?? segmentLines([{ kind: "same", text: props.text ?? "" }]);
  const shown = () => all().slice(0, MAX_LINES);
  return (
    <div class="max-h-96 min-w-0 overflow-auto" data-side={props.side}>
      <p
        class="truncate px-2.5 py-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase"
        data-column={props.side}
      >
        {props.label}
      </p>
      <div class={cx("min-w-0", props.dimmed && "opacity-40")}>
        <Show
          when={props.text !== undefined && props.text !== ""}
          fallback={
            <p class="px-2.5 py-1 text-smallest text-on-surface-tertiary italic">
              {props.text === undefined ? t("Nothing on this side") : t("(empty)")}
            </p>
          }
        >
          <For each={shown()}>
            {(line, index) => (
              <div class={cx(LINE, TINT[props.side])}>
                <span class="min-w-0 break-words">
                  <Show when={line.length > 0} fallback={<span> </span>}>
                    <For each={line}>
                      {(segment) => (
                        <Show when={segment.kind !== "same"} fallback={<span>{segment.text}</span>}>
                          <mark class={cx("rounded-xs px-px font-semibold", MARK[props.side])}>
                            {segment.text}
                          </mark>
                        </Show>
                      )}
                    </For>
                  </Show>
                </span>
                <Show when={index() === shown().length - 1 && all().length > MAX_LINES}>
                  <span class="ms-auto shrink-0 opacity-70">
                    {t("+{count} more", { count: all().length - MAX_LINES })}
                  </span>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

export interface UnitCardProps {
  readonly unit: DecisionUnit;
  /** The chosen side, or `undefined` while nobody has chosen. */
  readonly decision: MergeSide | undefined;
  /** The left column's text — `current` in the engine's vocabulary. */
  readonly currentText: string | undefined;
  /** The right column's text — `baseline`. */
  readonly baselineText: string | undefined;
  readonly currentLabel: string;
  readonly baselineLabel: string;
  readonly currentShort: string;
  readonly baselineShort: string;
  /** Off when neither side can be written: the review is reading only. */
  readonly decidable: boolean;
  readonly onDecide: (side: MergeSide | undefined) => void;
}

export function UnitCard(props: UnitCardProps) {
  /**
   * The word diff of this unit, once. A memo because it is the expensive part
   * of drawing the list and a decision click must not recompute it.
   *
   * The engine's own runs are preferred when it supplied them
   * (`DecisionUnit.text`, `onion::diff::unit_text_diff` over the reader-visible
   * bytes); the interim computes them here from the two strings actually on
   * screen, which is also what makes the marks follow the markup toggle.
   */
  const marked = createMemo(
    () => {
      const left = props.currentText;
      const right = props.baselineText;
      if (left === undefined || right === undefined) return undefined;
      const engine = props.unit.text;
      if (engine !== undefined)
        return {
          current: segmentLines(
            engine.current.map((run) => ({
              kind: run.kind === "added" ? ("add" as const) : ("same" as const),
              text: run.text,
            })),
          ),
          baseline: segmentLines(
            engine.baseline.map((run) => ({
              kind: run.kind === "removed" ? ("remove" as const) : ("same" as const),
              text: run.text,
            })),
          ),
        };
      const segments = inlineDiff(right, left);
      // Nothing shared means nothing worth marking — a whole-unit swap. The
      // plain tinted text says that better than marking every word does.
      if (!hasInlineChange(segments) || !segments.some((part) => part.kind === "same"))
        return undefined;
      return {
        baseline: segmentLines(sideOf(segments, "before")),
        current: segmentLines(sideOf(segments, "after")),
      };
    },
    { name: "reviewUnitMarks" },
  );

  const choose = (side: MergeSide) => () =>
    props.onDecide(props.decision === side ? undefined : side);

  return (
    <Card
      padded={false}
      class="overflow-hidden"
      data-review-unit={props.unit.id}
      data-status={props.unit.status}
      data-decision={props.decision ?? "undecided"}
      data-markup-only={props.unit.isUsfmStructureChange ? "true" : undefined}
    >
      <div class="flex flex-wrap items-center gap-2 border-b border-surface-border bg-surface-secondary px-2.5 py-1.5">
        <strong class="text-small font-semibold tabular-nums text-on-surface-primary">
          {unitReference(props.unit)}
        </strong>
        <Badge tone={STATUS_TONE[props.unit.status]}>{t(STATUS_LABEL[props.unit.status])}</Badge>
        <Show when={props.unit.isUsfmStructureChange}>
          {/* The reading is identical on both sides: what changed is USFM and
              nothing else. Worth a badge, because the default view is the
              reading, in which such a change is invisible. */}
          <Badge tone="muted" data-badge="markup-only">
            {t("markup only")}
          </Badge>
        </Show>
        <Show when={props.unit.isWhitespaceChange}>
          <Badge tone="muted">{t("whitespace only")}</Badge>
        </Show>
        <Show when={props.unit.relabeled}>
          <Badge tone="muted">{t("renumbered")}</Badge>
        </Show>
        <Show when={props.unit.isDup}>
          <Badge tone="warning">{t("duplicate reference")}</Badge>
        </Show>
        <Show when={props.decidable}>
          <div class="ms-auto flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant={props.decision === "current" ? "primary" : "tertiary"}
              aria-pressed={props.decision === "current" ? "true" : "false"}
              onClick={choose("current")}
            >
              {t("Keep {source}'s", { source: props.currentShort })}
            </Button>
            <Button
              size="sm"
              variant={props.decision === "baseline" ? "primary" : "tertiary"}
              aria-pressed={props.decision === "baseline" ? "true" : "false"}
              onClick={choose("baseline")}
            >
              {t("Take {source}'s", { source: props.baselineShort })}
            </Button>
          </div>
        </Show>
      </div>
      <div class="grid gap-px border-t border-surface-border sm:grid-cols-2">
        <Side
          text={props.currentText}
          marked={marked()?.current}
          side="current"
          label={props.currentLabel}
          dimmed={props.decision === "baseline"}
        />
        <Side
          text={props.baselineText}
          marked={marked()?.baseline}
          side="baseline"
          label={props.baselineLabel}
          dimmed={props.decision === "current"}
        />
      </div>
    </Card>
  );
}
