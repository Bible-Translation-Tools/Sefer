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

import { EditorView } from "@codemirror/view";
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";
import type { DecisionUnit } from "#core/galley/diff";
import type { ObservabilityService } from "#core/observability";
import {
  analyzer,
  liveDiff,
  modeView,
  mountDiffView,
  mountSatellite,
  readingLayer,
  repaintDiff,
  watchLocation,
  type DiffPaint,
  type DiffViewMount,
  type EditorBook,
} from "#editor/index";

import "#editor/editor.css";

import { t } from "../../i18n";
import { cx } from "../primitives";
import { goneBlock, sameFields, type DiffSides } from "./DiffCard";
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
  /**
   * The current side, EDITABLE: the Book itself, as a satellite with the diff
   * as a plugin on it (Review's Result mode). An edit goes through the Book's
   * funnel like any other; the review compares again and repaints. Absent,
   * the current side is a read-only view of the text in `sides`.
   */
  readonly live?:
    | { readonly book: EditorBook; readonly analyze: (text: string) => Analysis }
    | undefined;
}) {
  const [left, setLeft] = createSignal<HTMLDivElement | undefined>(undefined, { name: "bookLeft" });
  const [right, setRight] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "bookRight",
  });

  let mounts: {
    side: Side | "unified";
    mount: DiffViewMount;
    paint: () => DiffPaint;
    live: boolean;
  }[] = [];

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

  /**
   * What the views are built from, compared FIELD BY FIELD. A new comparison
   * hands over a new `sides` object every time; without this the effect below
   * would see a new dependency object and rebuild every view — including a
   * live pane, under the caret of the person typing in it.
   */
  const built = createMemo(
    () => ({
      bookId: props.sides.bookId,
      baselineText: props.sides.baselineText,
      // A live pane follows the Book itself: a new comparison of the same book
      // REPAINTS it (below) rather than rebuilding the view under the caret.
      currentText: props.live === undefined ? props.sides.currentText : undefined,
      live: props.live,
      split: props.split,
      markup: props.usfm,
      decidable: props.controls !== undefined,
      l: left(),
      r: right(),
    }),
    { name: "bookDiffBuilt", equals: sameFields },
  );

  createEffect(
    () => built(),
    ({ split, markup, live, l, r }) => {
      if (r === undefined || (split && l === undefined)) return;
      // The latest comparison, read when painting: in a live pane it moves on
      // every accepted edit while the view stays.
      const now = () => untrack(() => ({ sides: props.sides, units: props.units }));
      const { sides } = now();
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
            const unit = unitAt(now().units, side, probe);
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
        if (side !== "baseline" && live !== undefined) {
          const release = live.book.hold();
          const satellite = mountSatellite({
            parent,
            host: live.book.funnel(),
            range: { from: 0, to: live.book.state.doc.length },
            editable: true,
            label: `review:${sides.bookId}`,
            extensions: [
              modeView(mode, "cm-diff"),
              analyzer.of(live.analyze),
              readingLayer,
              ...liveDiff(paint()),
            ],
          });
          const mount: DiffViewMount = {
            view: satellite.view,
            repaint: (next) => repaintDiff(satellite.view, next),
            setMode: () => {},
            showAt: (at) => {
              satellite.view.dispatch({
                effects: EditorView.scrollIntoView(Math.min(at, satellite.view.state.doc.length), {
                  y: "start",
                }),
              });
            },
            destroy: () => {
              satellite.destroy();
              release();
            },
          };
          held.push({ side, mount, paint, live: true });
          return mount;
        }
        const analysis = side === "baseline" ? sides.baseline : sides.current;
        const mount = mountDiffView({
          parent,
          text,
          analyze: () => analysis,
          mode,
          paint: paint(),
        });
        held.push({ side, mount, paint, live: false });
        return mount;
      };

      const painted = op.span("review.diff.mount");
      if (split && l !== undefined) {
        const was = add("baseline", l, sides.baselineText, () =>
          sidePaint(now().units, "baseline", markup, undefined, now().sides.baseline),
        );
        const current = add("current", r, sides.currentText, () =>
          sidePaint(now().units, "current", markup, controls(), now().sides.current),
        );
        follow("baseline", was);
        follow("current", current);
      } else {
        const current = add("unified", r, sides.currentText, () =>
          unifiedPaint(
            now().units,
            markup,
            controls(),
            goneBlock(now().sides.baseline, mode),
            now().sides.current,
          ),
        );
        follow("current", current);
      }
      painted();
      op.end("passed", { "diff.units": now().units.length, "diff.live": live !== undefined });
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

  // A decision, or a new comparison of a live pane, repaints in place. A live
  // pane whose text has moved past the comparison (the next keystroke landed
  // first) keeps its mapped decorations until the comparison catches up.
  createEffect(
    () => ({
      units: props.units,
      text: props.sides.currentText,
      decided: props.units.map((unit) => props.controls?.decision(unit) ?? "-").join(","),
    }),
    ({ text }) => {
      for (const entry of mounts) {
        if (entry.live && entry.mount.view.state.doc.length !== text.length) continue;
        entry.mount.repaint(entry.paint());
      }
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
        <p class="truncate pb-1 text-smallest text-on-surface-tertiary">
          {props.currentLabel}
          <Show when={props.live !== undefined}>
            <span class="text-brand"> · {t("editable")}</span>
          </Show>
        </p>
        <div
          class={cx("cm-diff-pane min-h-0 flex-1", props.live !== undefined && "cm-diff-live")}
          ref={setRight}
        />
      </div>
    </div>
  );
}
