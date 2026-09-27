/**
 * One change as a card: the diff view (`#editor` `mountDiffView`) CLIPPED to
 * the change and its context, so it reads exactly as the editor does —
 * regular mode or USFM, split (baseline beside current) or unified (the
 * current text with the baseline's words struck through where they were).
 *
 * The gutter holds each unit's decision; the header's `actions` slot is the
 * caller's (a card's "keep all here"), and a double-click asks the caller to
 * open the change in the whole book.
 *
 * A card whose every change is formatting — markup or spacing, the words
 * identical — is drawn in USFM whatever the mode says: in the reading those
 * changes are invisible, and a card showing the same words twice with a
 * badge as the only clue is the card telling you nothing.
 */

import type { JSX } from "@solidjs/web";
import { Show, createEffect, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";
import type { DecisionUnit } from "#core/galley/diff";
import { mountDiffView, mountStamp, type DiffViewMount } from "#editor/index";

import "#editor/editor.css";

import { Badge, Card, cx } from "../primitives";
import { hunkKind, hunkLabel, isFormatting, type Hunk } from "./hunks";
import { sidePaint, unifiedPaint, type Controls } from "./paint";

/** Both texts of one book, and their parses — what every card of that book reads. */
export interface DiffSides {
  readonly bookId: string;
  readonly baselineText: string;
  readonly currentText: string;
  readonly baseline: Analysis;
  readonly current: Analysis;
}

/**
 * A unit that only the baseline has, drawn as a block where it stood: a stamp
 * of the baseline's own rendering, so it reads like the page too.
 */
export const goneBlock =
  (baseline: Analysis, mode: "usfm" | "default") =>
  (unit: DecisionUnit): HTMLElement => {
    const block = document.createElement("div");
    block.className = "cm-diff-gone";
    if (unit.baseline !== undefined)
      mountStamp({
        parent: block,
        analysis: baseline,
        range: unit.baseline,
        mode,
        marks: [],
        surface: "cm-excerpt",
        label: `gone:${unit.id}`,
      });
    return block;
  };

export function DiffCard(props: {
  readonly hunk: Hunk;
  readonly sides: DiffSides;
  readonly split: boolean;
  readonly usfm: boolean;
  readonly controls: Controls | undefined;
  /** Column captions in a split: what each source calls itself. */
  readonly currentLabel: string;
  readonly baselineLabel: string;
  /**
   * Which text a split puts first. `/review` puts the current side where its
   * picker is (left); the conventional was-then-now puts the baseline first.
   */
  readonly currentFirst?: boolean;
  readonly actions?: JSX.Element;
  readonly onOpen?: () => void;
  readonly onMounted?: (ms: number) => void;
}) {
  const [left, setLeft] = createSignal<HTMLDivElement | undefined>(undefined, { name: "cardLeft" });
  const [right, setRight] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "cardRight",
  });

  const formatting = (): boolean => props.hunk.units.every(isFormatting);
  const usfm = (): boolean => props.usfm || formatting();

  /** The views of this card, and how to paint them — for a repaint in place. */
  let painted: { mount: DiffViewMount; paint: () => ReturnType<typeof sidePaint> }[] = [];

  createEffect(
    () => ({
      l: left(),
      r: right(),
      // A new text (a take landed, an edit) is a new document to clip.
      hunk: props.hunk,
      sides: props.sides,
      split: props.split,
      markup: usfm(),
      decidable: props.controls !== undefined,
    }),
    ({ l, r, hunk, sides, split, markup }) => {
      if (r === undefined) return;
      const started = performance.now();
      const controls = (): Controls | undefined => untrack(() => props.controls);
      const mode = markup ? "usfm" : "default";
      const views: typeof painted = [];
      const mount = (
        parent: HTMLElement,
        text: string,
        analysis: Analysis,
        clip: { from: number; to: number },
        paint: () => ReturnType<typeof sidePaint>,
      ): void => {
        views.push({
          mount: mountDiffView({
            parent,
            text,
            analyze: () => analysis,
            mode,
            clip,
            surface: "cm-diff cm-diff-card",
            paint: paint(),
          }),
          paint,
        });
      };
      if (split) {
        if (l !== undefined && hunk.baseline !== undefined)
          mount(l, sides.baselineText, sides.baseline, hunk.baseline, () =>
            sidePaint(
              hunk.units,
              "baseline",
              markup,
              undefined,
              sides.baseline,
              hunk.baselineStart,
            ),
          );
        mount(r, sides.currentText, sides.current, hunk.current, () =>
          sidePaint(hunk.units, "current", markup, controls(), sides.current, hunk.currentStart),
        );
      } else {
        mount(r, sides.currentText, sides.current, hunk.current, () =>
          unifiedPaint(
            hunk.units,
            markup,
            controls(),
            goneBlock(sides.baseline, mode),
            sides.current,
            hunk.currentStart,
          ),
        );
      }
      painted = views;
      props.onMounted?.(performance.now() - started);
      return () => {
        painted = [];
        for (const view of views) view.mount.destroy();
      };
    },
  );

  // A decision repaints the card in place: the text did not move, only its tint.
  createEffect(
    () => props.hunk.units.map((unit) => props.controls?.decision(unit) ?? "-").join(","),
    () => {
      for (const view of painted) view.mount.repaint(view.paint());
    },
  );

  const status = (): string =>
    props.hunk.units.length === 1
      ? (props.hunk.units[0]?.status ?? "")
      : `${props.hunk.units.length} changes`;

  return (
    <Card
      padded={false}
      class="overflow-hidden"
      data-diff-card={props.hunk.key}
      onDblClick={() => props.onOpen?.()}
    >
      <header class="flex flex-wrap items-center gap-2 border-b border-surface-border px-3 py-1.5">
        <strong class="text-small font-medium text-on-surface-primary tabular-nums">
          {hunkLabel(props.hunk)}
        </strong>
        <span class="text-smallest text-on-surface-tertiary">{status()}</span>
        <Show when={hunkKind(props.hunk.units)}>
          {(kind) => (
            <Badge tone="muted" data-diff-kind={kind()}>
              {kind()}
            </Badge>
          )}
        </Show>
        <Show when={props.actions}>
          <div class="ms-auto flex shrink-0 items-center gap-1">{props.actions}</div>
        </Show>
      </header>
      <Show when={props.split}>
        <div class="grid grid-cols-2 divide-x divide-surface-border border-b border-surface-border text-smallest text-on-surface-tertiary">
          <span class={cx("truncate px-3 py-0.5", props.currentFirst === true && "order-last")}>
            {props.baselineLabel}
          </span>
          <span class="truncate px-3 py-0.5">{props.currentLabel}</span>
        </div>
      </Show>
      <div class={props.split ? "grid grid-cols-2 divide-x divide-surface-border" : ""}>
        <Show when={props.split}>
          <div class={cx("min-w-0", props.currentFirst === true && "order-last")} ref={setLeft}>
            <Show when={props.hunk.baseline === undefined}>
              <p class="px-3 py-2 text-small text-on-surface-tertiary italic">
                Not in {props.baselineLabel}.
              </p>
            </Show>
          </div>
        </Show>
        <div class="min-w-0" ref={setRight} />
      </div>
    </Card>
  );
}
