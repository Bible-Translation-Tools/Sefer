/**
 * The whole book with the diff drawn on it: the book reads as it does in the
 * editor (regular mode or USFM), and the engine's units are decoration on it —
 * split, each side its own whole text, or unified, the current text with the
 * baseline's words struck through where they were and a baseline-only unit
 * drawn as a block where it stood.
 *
 * In a split the two panes are an aligned group (`createAlignedGroup`): they
 * follow each other by VERSE, and only when the verse scrolled to is not
 * already on screen in the other. They once followed by place, and that was
 * too eager: once the texts' heights differ (a reviewer deleted a run of `\p`
 * and `\q` lines, say), a small scroll in one moved the other by a screen.
 * Next / previous change (`showUnit`) still brings the unit to each pane's
 * MIDDLE — where it stands, or where it would stand in a text that lacks it. `onPlace` reports
 * the unit at the top of the current pane, so a counter can say where you are.
 */

import { EditorView } from "@codemirror/view";
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";
import type { DecisionUnit } from "#core/galley/diff";
import type { ObservabilityService } from "#core/observability";
import {
  analyzer,
  createAlignedGroup,
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
import { sameFields, wasBlock, type DiffSides } from "./DiffCard";
import { hunkPaint, sidePaint, type Controls, type Side } from "./paint";

export interface BookDiffApi {
  readonly showUnit: (unit: DecisionUnit) => void;
  /** The offset at the middle of your pane: where a step counts from. */
  readonly middle: () => number | undefined;
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
  /** Whether the split's two panes follow each other by verse; read at each scroll. */
  readonly linked?: () => boolean;
  readonly observability: ObservabilityService;
  /** Shown at the top once the views are mounted: where "open in the book" lands. */
  readonly initial?: DecisionUnit | undefined;
  readonly ref?: (api: BookDiffApi) => void;
  readonly onPlace?: (unit: DecisionUnit | undefined) => void;
  readonly class?: string;
  /**
   * The current side, EDITABLE: the Book itself, as a satellite with the diff
   * as a plugin on it (an editable Review). An edit goes through the Book's
   * funnel like any other; the review compares again and repaints. Absent,
   * the current side is a read-only view of the text in `sides`.
   */
  readonly live?:
    | { readonly book: EditorBook; readonly analyze: (text: string) => Analysis }
    | undefined;
  /**
   * The current side WILL be live, once the book is seated: build nothing
   * until then. Built read-only first, every view was built twice — a whole
   * book's two editors torn down and made again a moment later.
   */
  readonly awaitLive?: boolean;
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

  /**
   * Where `unit` is in one side's text: its start, or, in a text that lacks
   * it, the end of the nearest unit before it that the text has.
   */
  const placeIn = (side: Side, unit: DecisionUnit): number | undefined => {
    const own = side === "baseline" ? unit.baseline : unit.current;
    if (own !== undefined) return own.from;
    const units = untrack(() => props.units);
    for (let index = units.indexOf(unit) - 1; index >= 0; index--) {
      const before = units[index];
      const span =
        before === undefined ? undefined : side === "baseline" ? before.baseline : before.current;
      if (span !== undefined) return span.to;
    }
    return 0;
  };
  const showUnit = (unit: DecisionUnit): void => {
    for (const entry of mounts) {
      const at = placeIn(entry.side === "baseline" ? "baseline" : "current", unit);
      if (at !== undefined) entry.mount.showAt(at, "center");
    }
  };
  /** The offset at the middle of your pane, where the reader is. */
  const middle = (): number | undefined => {
    const entry = mounts.find((held) => held.side !== "baseline");
    if (entry === undefined) return undefined;
    const view = entry.mount.view;
    const box = view.scrollDOM.getBoundingClientRect();
    const y = box.top + box.height / 2;
    return (
      view.posAtCoords({ x: box.left + box.width / 2, y }, false) ??
      view.lineBlockAtHeight(y - view.documentTop).from
    );
  };
  createEffect(
    () => props.ref,
    (give) => {
      give?.({ showUnit, middle });
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
      waiting: props.awaitLive === true && props.live === undefined,
      l: left(),
      r: right(),
    }),
    { name: "bookDiffBuilt", equals: sameFields },
  );

  createEffect(
    () => built(),
    ({ split, markup, live, waiting, l, r }) => {
      if (waiting || r === undefined || (split && l === undefined)) return;
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

      // Each pane only REPORTS its place: the counter follows the current
      // pane. Neither pane moves the other.
      const follow = (side: Side, mount: DiffViewMount): void => {
        if (split && side !== "current") return;
        releases.push(
          watchLocation(mount.view, (where) => {
            if (where === null) return;
            // The END of the line at the top, not its start: a visual line in
            // regular mode opens with the bare `\q1` that belongs to the unit
            // BEFORE, and reporting that would name the verse above.
            const probe = Math.max(where.top, mount.view.lineBlockAt(where.top).to - 1);
            report(unitAt(now().units, side, probe));
          }),
        );
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
            showAt: (at, y = "start") => {
              satellite.view.dispatch({
                effects: EditorView.scrollIntoView(Math.min(at, satellite.view.state.doc.length), {
                  y,
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
        // The two panes, aligned by verse: either leads, the other follows.
        const group = createAlignedGroup("reveal");
        const linked = (): boolean => untrack(() => props.linked?.() ?? true);
        releases.push(
          group.join({ view: was.view, book: sides.bookId, leads: linked, follows: linked }),
          group.join({ view: current.view, book: sides.bookId, leads: linked, follows: linked }),
        );
      } else {
        const current = add("unified", r, sides.currentText, () =>
          hunkPaint(
            now().units,
            markup,
            controls(),
            wasBlock(now().sides.baseline, mode),
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
        if (entry.live) {
          // Painted only over EXACTLY the text compared, as a card is.
          const doc = entry.mount.view.state.doc;
          if (doc.length !== text.length || doc.toString() !== text) continue;
        }
        // A snapshot of the decisions: the compute above is what tracks them.
        entry.mount.repaint(untrack(entry.paint));
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
          class={cx(
            "cm-diff-pane min-h-0 flex-1",
            props.live !== undefined && "cm-diff-live",
            props.controls !== undefined && "cm-diff-deciding",
          )}
          ref={setRight}
        />
      </div>
    </div>
  );
}
