import {
  createAlignedGroup,
  editorPolicy,
  mountCard,
  mountDiffView,
  type DiffPaint,
  type EditorBook,
  type EditorHandle,
} from "@sefer/editor";
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";
import type { DecisionUnit } from "#core/galley/diff";
import type { ObservabilityService } from "#core/observability";

import "@sefer/editor/editor.css";

import { t } from "../../i18n";
import { cx } from "../primitives";
import { sameFields, wasBlock, type DiffSides } from "./DiffCard";
import { hunkPaint, sidePaint, type Controls, type Side } from "./paint";

export interface BookDiffApi {
  readonly showUnit: (unit: DecisionUnit) => void;
  readonly middle: () => number | undefined;
}

const spanOn = (side: Side, unit: DecisionUnit) =>
  side === "baseline" ? unit.baseline : unit.current;

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

export interface BookDiffProps {
  readonly sides: DiffSides;
  readonly units: readonly DecisionUnit[];
  readonly split: boolean;
  readonly usfm: boolean;
  readonly controls: Controls | undefined;
  readonly currentLabel: string;
  readonly baselineLabel: string;
  readonly currentFirst?: boolean;
  readonly linked?: () => boolean;
  readonly observability: ObservabilityService;
  readonly initial?: DecisionUnit | undefined;
  readonly ref?: (api: BookDiffApi) => void;
  readonly onPlace?: (unit: DecisionUnit | undefined) => void;
  readonly class?: string;
  readonly live?:
    | { readonly book: EditorBook; readonly analyze: (text: string) => Analysis }
    | undefined;
  readonly awaitLive?: boolean;
}

interface Pane {
  readonly editor: EditorHandle;
  repaint(paint: DiffPaint): void;
  showAt(at: number, align?: "start" | "center"): void;
  destroy(): void;
}

interface Mounted {
  side: Side | "unified";
  mount: Pane;
  paint: () => DiffPaint;
  live: boolean;
}

interface MountArgs {
  readonly split: boolean;
  readonly markup: boolean;
  readonly live: BookDiffProps["live"];
  readonly leftHost: HTMLDivElement | undefined;
  readonly rightHost: HTMLDivElement;
  readonly now: () => { sides: DiffSides; units: readonly DecisionUnit[] };
  readonly operation: ReturnType<ObservabilityService["operation"]>;
  readonly controls: () => Controls | undefined;
  readonly report: (unit: DecisionUnit | undefined) => void;
  readonly linked: () => boolean;
}

const mountPanes = (args: MountArgs): { held: Mounted[]; release: () => void } => {
  const { split, markup, live, leftHost, rightHost, now, operation, controls, report, linked } =
    args;
  const { sides } = now();
  const mode = markup ? "usfm" : "default";
  const held: Mounted[] = [];
  const releases: (() => void)[] = [];

  const follow = (side: Side, mount: Pane): void => {
    if (split && side !== "current") return;
    releases.push(
      mount.editor.onViewport((where) => {
        if (where === null) return;
        const probe = Math.max(where.top, where.topLineEnd - 1);
        report(unitAt(now().units, side, probe));
      }),
    );
  };

  const add = (
    side: Side | "unified",
    parent: HTMLElement,
    text: string,
    paint: () => DiffPaint,
  ): Pane => {
    if (side !== "baseline" && live !== undefined) {
      const card = mountCard({
        parent,
        book: live.book,
        range: { from: 0, to: live.book.source().text.length },
        clip: false,
        policy: editorPolicy(mode === "usfm" ? "usfm" : "regular"),
        surface: "cm-diff",
        analyze: live.analyze,
        diff: paint(),
        label: `review:${sides.bookId}`,
      });
      const mount: Pane = {
        editor: card,
        repaint: (next) => card.setDiff(next),
        showAt: (at, align = "start") => card.reveal({ from: at }, { scroll: align }),
        destroy: () => card.destroy(),
      };
      held.push({ side, mount, paint, live: true });
      return mount;
    }
    const analysis = side === "baseline" ? sides.baseline : sides.current;
    const view = mountDiffView({
      parent,
      text,
      analyze: () => analysis,
      mode,
      paint: paint(),
    });
    const mount: Pane = {
      editor: view,
      repaint: (next) => view.repaint(next),
      showAt: (at, align) => view.showAt(at, align),
      destroy: () => view.destroy(),
    };
    held.push({ side, mount, paint, live: false });
    return mount;
  };

  const painted = operation.span("review.diff.mount");
  if (split && leftHost !== undefined) {
    const was = add("baseline", leftHost, sides.baselineText, () =>
      sidePaint(now().units, "baseline", markup, undefined, now().sides.baseline),
    );
    const current = add("current", rightHost, sides.currentText, () =>
      sidePaint(now().units, "current", markup, controls(), now().sides.current),
    );
    follow("baseline", was);
    follow("current", current);
    const group = createAlignedGroup("reveal");
    releases.push(
      group.join({ editor: was.editor, book: sides.bookId, leads: linked, follows: linked }),
      group.join({
        editor: current.editor,
        book: sides.bookId,
        leads: linked,
        follows: linked,
      }),
    );
  } else {
    const current = add("unified", rightHost, sides.currentText, () =>
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
  operation.end("passed", {
    "diff.units": now().units.length,
    "diff.live": live !== undefined,
  });
  return {
    held,
    release: () => {
      for (const release of releases) release();
      for (const entry of held) entry.mount.destroy();
    },
  };
};

export function BookDiff(props: BookDiffProps) {
  const [left, setLeft] = createSignal<HTMLDivElement | undefined>(undefined, { name: "bookLeft" });
  const [right, setRight] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "bookRight",
  });

  let mounts: Mounted[] = [];

  const placeIn = (side: Side, unit: DecisionUnit): number | undefined => {
    const own = spanOn(side, unit);
    if (own !== undefined) return own.from;
    const units = untrack(() => props.units);
    for (let index = units.indexOf(unit) - 1; index >= 0; index--) {
      const before = units[index];
      const span = before === undefined ? undefined : spanOn(side, before);
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
  const middle = (): number | undefined => {
    const entry = mounts.find((held) => held.side !== "baseline");
    return entry?.mount.editor.centerOffset();
  };
  createEffect(
    () => props.ref,
    (give) => {
      give?.({ showUnit, middle });
    },
  );

  const built = createMemo(
    () => ({
      bookId: props.sides.bookId,
      baselineText: props.sides.baselineText,
      currentText: props.live === undefined ? props.sides.currentText : undefined,
      live: props.live,
      split: props.split,
      markup: props.usfm,
      decidable: props.controls !== undefined,
      waiting: props.awaitLive === true && props.live === undefined,
      leftHost: left(),
      rightHost: right(),
    }),
    { name: "bookDiffBuilt", equals: sameFields },
  );

  createEffect(
    () => built(),
    ({ split, markup, live, waiting, leftHost, rightHost }) => {
      if (waiting || rightHost === undefined || (split && leftHost === undefined)) return;
      const now = () => untrack(() => ({ sides: props.sides, units: props.units }));
      const { sides } = now();
      const observability = untrack(() => props.observability);
      const operation = observability.operation("review.diff.book", {
        "diff.book": sides.bookId,
        "diff.layout": split ? "split" : "unified",
        "diff.mode": markup ? "usfm" : "regular",
      });
      const controls = (): Controls | undefined => untrack(() => props.controls);
      const onPlace = untrack(() => props.onPlace);
      const report = (unit: DecisionUnit | undefined): void => onPlace?.(unit);
      const linked = (): boolean => untrack(() => props.linked?.() ?? true);
      const { held, release } = mountPanes({
        split,
        markup,
        live,
        leftHost,
        rightHost,
        now,
        operation,
        controls,
        report,
        linked,
      });
      mounts = held;
      const first = untrack(() => props.initial);
      if (first !== undefined) requestAnimationFrame(() => showUnit(first));

      return () => {
        mounts = [];
        release();
      };
    },
  );

  createEffect(
    () => ({
      units: props.units,
      text: props.sides.currentText,
      decided: props.units.map((unit) => props.controls?.decision(unit) ?? "-").join(","),
    }),
    ({ text }) => {
      for (const entry of mounts) {
        if (entry.live) {
          const editor = entry.mount.editor;
          if (editor.length() !== text.length || editor.text() !== text) continue;
        }
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
