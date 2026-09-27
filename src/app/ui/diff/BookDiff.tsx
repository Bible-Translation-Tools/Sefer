/**
 * The whole book with the diff drawn on it: the book reads as it does in the
 * editor (regular mode or USFM), and the engine's units are decoration on it —
 * split, each side its own whole text, or unified, the current text with the
 * baseline's words struck through where they were and a baseline-only unit
 * drawn as a block where it stood.
 *
 * In a split, the pane you are not reading follows your PLACE — the reference
 * pane's `watchLocation` pattern: the pane being read reports the offset at
 * its top, the unit there is found, and the other pane shows that unit's pair
 * at its own top. Units are places both texts share, so following needs no
 * height bookkeeping. The pane last touched leads, and the follower's own
 * scroll reports are ignored, which is what keeps the two from chasing.
 *
 * `showUnit` is how next / previous change moves it; `onPlace` reports the
 * unit at the top of the current pane, so a counter can say where you are.
 */

import { Show, createEffect, createSignal, untrack } from "solid-js";

import type { DecisionUnit } from "#core/galley/diff";
import type { ObservabilityService } from "#core/observability";
import { mountDiffView, watchLocation, type DiffPaint, type DiffViewMount } from "#editor/index";

import "#editor/editor.css";

import { cx } from "../primitives";
import { goneBlock, type DiffSides } from "./DiffCard";
import { sidePaint, unifiedPaint, type Controls, type Side } from "./paint";

export interface BookDiffApi {
  readonly showUnit: (unit: DecisionUnit) => void;
}

/** The unit whose span on `side` holds `at`, or the last one before it. */
const unitAt = (
  units: readonly DecisionUnit[],
  side: Side,
  at: number,
): DecisionUnit | undefined => {
  let found: DecisionUnit | undefined;
  for (const unit of units) {
    const span = side === "baseline" ? unit.baseline : unit.current;
    if (span === undefined) continue;
    if (span.from > at) break;
    found = unit;
  }
  return found;
};

export function BookDiff(props: {
  readonly sides: DiffSides;
  /** The whole book in reading order (`ordered`), unchanged units included. */
  readonly units: readonly DecisionUnit[];
  readonly split: boolean;
  readonly usfm: boolean;
  readonly controls: Controls | undefined;
  readonly currentLabel: string;
  readonly baselineLabel: string;
  readonly currentFirst?: boolean;
  readonly observability: ObservabilityService;
  /** Shown at the top once the views are mounted: where "open in the book" lands. */
  readonly initial?: DecisionUnit | undefined;
  readonly ref?: (api: BookDiffApi) => void;
  readonly onPlace?: (unit: DecisionUnit | undefined) => void;
  readonly class?: string;
}) {
  const [left, setLeft] = createSignal<HTMLDivElement | undefined>(undefined, { name: "bookLeft" });
  const [right, setRight] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "bookRight",
  });

  let mounts: { side: Side | "unified"; mount: DiffViewMount; paint: () => DiffPaint }[] = [];

  const showUnit = (unit: DecisionUnit): void => {
    // A pane the unit is not in stays where it is: in a split it is the
    // follower, and follows the pane that moved.
    for (const entry of mounts) {
      const span = entry.side === "baseline" ? unit.baseline : unit.current;
      if (span !== undefined) entry.mount.showAt(span.from);
    }
  };
  createEffect(
    () => props.ref,
    (give) => {
      give?.({ showUnit });
    },
  );

  createEffect(
    () => ({
      sides: props.sides,
      units: props.units,
      split: props.split,
      markup: props.usfm,
      decidable: props.controls !== undefined,
      l: left(),
      r: right(),
    }),
    ({ sides, units, split, markup, l, r }) => {
      if (r === undefined || (split && l === undefined)) return;
      const observability = untrack(() => props.observability);
      const op = observability.operation("review.diff.book", {
        "diff.book": sides.bookId,
        "diff.layout": split ? "split" : "unified",
        "diff.mode": markup ? "usfm" : "regular",
      });
      const mode = markup ? "usfm" : "default";
      const controls = (): Controls | undefined => untrack(() => props.controls);
      const onPlace = untrack(() => props.onPlace);
      const report = (unit: DecisionUnit | undefined): void => onPlace?.(unit);
      const held: typeof mounts = [];
      const releases: (() => void)[] = [];

      let leader: Side = "current";
      const follow = (side: Side, mount: DiffViewMount): void => {
        releases.push(
          watchLocation(mount.view, (where) => {
            if (where === null) return;
            // The END of the line at the top, not its start: a visual line in
            // regular mode opens with the bare `\q1` that belongs to the unit
            // BEFORE, and following that would show the verse above.
            const probe = Math.max(where.top, mount.view.lineBlockAt(where.top).to - 1);
            const unit = unitAt(units, side, probe);
            if (side === "current" || !split) report(unit);
            if (!split || side !== leader) return;
            const target = held.find((entry) => entry.side !== side)?.mount;
            const at = side === "baseline" ? unit?.current?.from : unit?.baseline?.from;
            if (target === undefined || at === undefined) return;
            // A span, not an operation: it fires once a frame while scrolling.
            const done = observability.span("review.diff.follow", side);
            target.showAt(at);
            done();
          }),
        );
        const lead = (): void => {
          leader = side;
        };
        const events = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
        const host = mount.view.dom;
        for (const name of events) host.addEventListener(name, lead, { passive: true });
        releases.push(() => {
          for (const name of events) host.removeEventListener(name, lead);
        });
      };

      const add = (
        side: Side | "unified",
        parent: HTMLElement,
        text: string,
        paint: () => DiffPaint,
      ): DiffViewMount => {
        const analysis = side === "baseline" ? sides.baseline : sides.current;
        const mount = mountDiffView({
          parent,
          text,
          analyze: () => analysis,
          mode,
          paint: paint(),
        });
        held.push({ side, mount, paint });
        return mount;
      };

      const painted = op.span("review.diff.mount");
      if (split && l !== undefined) {
        const was = add("baseline", l, sides.baselineText, () =>
          sidePaint(units, "baseline", markup, undefined, sides.baseline),
        );
        const now = add("current", r, sides.currentText, () =>
          sidePaint(units, "current", markup, controls(), sides.current),
        );
        follow("baseline", was);
        follow("current", now);
      } else {
        const now = add("unified", r, sides.currentText, () =>
          unifiedPaint(units, markup, controls(), goneBlock(sides.baseline, mode), sides.current),
        );
        follow("current", now);
      }
      painted();
      op.end("passed", { "diff.units": units.length });
      mounts = held;
      const first = untrack(() => props.initial);
      if (first !== undefined) requestAnimationFrame(() => showUnit(first));

      return () => {
        mounts = [];
        for (const release of releases) release();
        for (const entry of held) entry.mount.destroy();
      };
    },
  );

  // A decision repaints in place: the text did not move, only its tint.
  createEffect(
    () =>
      props.units
        .filter((unit) => unit.status !== "unchanged")
        .map((unit) => props.controls?.decision(unit) ?? "-")
        .join(","),
    () => {
      for (const entry of mounts) entry.mount.repaint(entry.paint());
    },
  );

  return (
    <div
      class={cx(
        props.split ? "grid min-h-0 grid-cols-2 gap-3" : "grid min-h-0 grid-cols-1",
        props.class,
      )}
      data-diff-book={props.sides.bookId}
    >
      <Show when={props.split}>
        <div class={cx("flex min-h-0 flex-col", props.currentFirst === true && "order-last")}>
          <p class="truncate pb-1 text-smallest text-on-surface-tertiary">{props.baselineLabel}</p>
          <div class="cm-diff-pane min-h-0 flex-1" ref={setLeft} />
        </div>
      </Show>
      <div class="flex min-h-0 flex-col">
        <p class="truncate pb-1 text-smallest text-on-surface-tertiary">{props.currentLabel}</p>
        <div class="cm-diff-pane min-h-0 flex-1" ref={setRight} />
      </div>
    </div>
  );
}
