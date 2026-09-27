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
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";
import type { DecisionUnit } from "#core/galley/diff";
import {
  analyzer,
  clippedToScope,
  liveDiff,
  modeView,
  mountDiffView,
  mountSatellite,
  mountStamp,
  readingLayer,
  repaintDiff,
  wholeLines,
  type DiffPaint,
  type DiffViewMount,
  type EditorBook,
} from "#editor/index";

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

interface Pane {
  readonly mount: DiffViewMount;
  readonly paint: () => DiffPaint;
  readonly live: boolean;
}

/** A memo's `equals` for a record of dependencies: the same fields, the same run. */
export const sameFields = (
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
) => Object.keys(a).every((key) => a[key] === b[key]);

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
  /**
   * The current side, EDITABLE: the Book itself (Review's Result mode). The
   * card's lines are a satellite over it, with the diff as a plugin; an edit
   * goes through the Book's funnel, the review compares again, the card
   * repaints. Absent, the current side is a read-only clip of `sides`.
   */
  readonly live?:
    | { readonly book: EditorBook; readonly analyze: (text: string) => Analysis }
    | undefined;
  readonly onOpen?: () => void;
  readonly onMounted?: (ms: number) => void;
}) {
  const [left, setLeft] = createSignal<HTMLDivElement | undefined>(undefined, { name: "cardLeft" });
  const [right, setRight] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "cardRight",
  });

  const formatting = (): boolean => props.hunk.units.every(isFormatting);
  const usfm = (): boolean => props.usfm || formatting();

  /**
   * The latest hunk and sides, read when painting. A new comparison hands
   * over new objects every time; a pane that did not change must not be
   * rebuilt for it, least of all a live one somebody is typing in.
   */
  const now = () => untrack(() => ({ hunk: props.hunk, sides: props.sides }));
  const controls = (): Controls | undefined => untrack(() => props.controls);

  const currentPaint = (markup: boolean, split: boolean) => (): DiffPaint => {
    const { hunk, sides } = now();
    const mode = markup ? "usfm" : "default";
    return split
      ? sidePaint(hunk.units, "current", markup, controls(), sides.current, hunk.currentStart)
      : unifiedPaint(
          hunk.units,
          markup,
          controls(),
          goneBlock(sides.baseline, mode),
          sides.current,
          hunk.currentStart,
        );
  };
  const baselinePaint = (markup: boolean) => (): DiffPaint => {
    const { hunk, sides } = now();
    return sidePaint(hunk.units, "baseline", markup, undefined, sides.baseline, hunk.baselineStart);
  };

  /** The panes of this card, and how to paint them — for a repaint in place. */
  const panes = new Map<"baseline" | "current", Pane>();

  // The baseline pane: a read-only clip of the other side, rebuilt when its
  // text or its stretch does.
  const baselineBuilt = createMemo(
    () => ({
      l: left(),
      split: props.split,
      markup: usfm(),
      text: props.sides.baselineText,
      from: props.hunk.baseline?.from,
      to: props.hunk.baseline?.to,
    }),
    { name: "cardBaselineBuilt", equals: sameFields },
  );
  createEffect(
    () => baselineBuilt(),
    ({ l, split, markup, text, from, to }) => {
      if (!split || l === undefined || from === undefined || to === undefined) return;
      const { sides } = now();
      const paint = baselinePaint(markup);
      const mount = mountDiffView({
        parent: l,
        text,
        analyze: () => sides.baseline,
        mode: markup ? "usfm" : "default",
        clip: { from, to },
        surface: "cm-diff cm-diff-card",
        paint: paint(),
      });
      panes.set("baseline", { mount, paint, live: false });
      return () => {
        panes.delete("baseline");
        mount.destroy();
      };
    },
  );

  // The current pane: a read-only clip, or — given `live` — the Book itself,
  // an editor clipped to the card's lines with the diff as a plugin on it. A
  // live pane is rebuilt only when the card or the seat is a different one.
  const currentBuilt = createMemo(
    () => ({
      r: right(),
      split: props.split,
      markup: usfm(),
      decidable: props.controls !== undefined,
      key: props.hunk.key,
      live: props.live,
      text: props.live === undefined ? props.sides.currentText : undefined,
      from: props.live === undefined ? props.hunk.current.from : undefined,
      to: props.live === undefined ? props.hunk.current.to : undefined,
    }),
    { name: "cardCurrentBuilt", equals: sameFields },
  );
  createEffect(
    () => currentBuilt(),
    ({ r, split, markup, key, live }) => {
      if (r === undefined) return;
      const started = performance.now();
      const { hunk, sides } = now();
      const paint = currentPaint(markup, split);
      const mode = markup ? "usfm" : "default";
      let mount: DiffViewMount;
      if (live !== undefined) {
        const release = live.book.hold();
        const satellite = mountSatellite({
          parent: r,
          host: live.book.funnel(),
          range: wholeLines(live.book.state.doc, hunk.current),
          editable: true,
          label: `review:${key}`,
          extensions: [
            modeView(mode, "cm-diff cm-diff-card"),
            analyzer.of(live.analyze),
            readingLayer,
            clippedToScope(),
            ...liveDiff(paint()),
          ],
        });
        mount = {
          view: satellite.view,
          repaint: (next) => repaintDiff(satellite.view, next),
          setMode: () => {},
          showAt: () => {},
          destroy: () => {
            satellite.destroy();
            release();
          },
        };
      } else
        mount = mountDiffView({
          parent: r,
          text: sides.currentText,
          analyze: () => sides.current,
          mode,
          clip: hunk.current,
          surface: "cm-diff cm-diff-card",
          paint: paint(),
        });
      panes.set("current", { mount, paint, live: live !== undefined });
      props.onMounted?.(performance.now() - started);
      return () => {
        panes.delete("current");
        mount.destroy();
      };
    },
  );

  // A decision, or a new comparison, repaints in place. A live pane whose text
  // has moved past the comparison (the next keystroke landed first) keeps its
  // mapped decorations until the comparison catches up.
  createEffect(
    () => ({
      hunk: props.hunk,
      text: props.sides.currentText,
      decided: props.hunk.units.map((unit) => props.controls?.decision(unit) ?? "-").join(","),
    }),
    ({ text }) => {
      for (const pane of panes.values()) {
        if (pane.live && pane.mount.view.state.doc.length !== text.length) continue;
        pane.mount.repaint(pane.paint());
      }
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
