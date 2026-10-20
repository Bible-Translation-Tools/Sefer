import {
  mountDiffView,
  mountStamp,
  type CardMount,
  type DiffPaint,
  type EditorBook,
} from "@sefer/editor";
import type { JSX } from "@solidjs/web";
import CheckIcon from "lucide-solid/icons/check";
import CodeIcon from "lucide-solid/icons/code";
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Analysis, MergeSide } from "#core/galley";
import type { DecisionUnit } from "#core/galley/diff";

import "@sefer/editor/editor.css";

import { t } from "../../i18n";
import { CardActions, type CardAction } from "../multibuffer/CardAction";
import { CardEditor } from "../multibuffer/CardEditor";
import { CardFrame } from "../multibuffer/CardFrame";
import type { CardEvent, CardView, ContextStep } from "../multibuffer/cardState";
import { ContextControl } from "../multibuffer/ContextControl";
import { cardPolicy } from "../multibuffer/policy";
import { cx } from "../primitives";
import { hunkKind, type Hunk } from "./hunks";
import { hunkPaint, sidePaint, type Controls } from "./paint";

export interface DiffSides {
  readonly bookId: string;
  readonly baselineText: string;
  readonly currentText: string;
  readonly baseline: Analysis;
  readonly current: Analysis;
}

export const wasBlock =
  (baseline: Analysis, mode: "usfm" | "default") =>
  (unit: DecisionUnit): HTMLElement => {
    const block = document.createElement("div");
    block.className = "cm-diff-was";
    if (unit.baseline !== undefined)
      mountStamp({
        parent: block,
        analysis: baseline,
        range: unit.baseline,
        policy: cardPolicy(mode === "usfm" ? "usfm" : "regular"),
        marks: (unit.status === "modified" ? (unit.text?.baseline ?? []) : [])
          .filter((run) => run.kind !== "unchanged" && (run.what === "text" || mode === "usfm"))
          .map((run) => ({ from: run.from, to: run.to, class: "cm-diff-removed" })),
        surface: "cm-diff",
        label: `was:${unit.id}`,
      });
    return block;
  };

interface Pane {
  readonly mount: { repaint(paint: DiffPaint): void; text(): string; length(): number };
  readonly paint: () => DiffPaint;
  readonly live: boolean;
}

export const sameFields = (
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
) => Object.keys(a).every((key) => a[key] === b[key]);

export function DiffCard(props: {
  readonly hunk: Hunk;
  readonly sides: DiffSides;
  readonly split: boolean;
  readonly usfm: boolean;
  readonly view: CardView;
  readonly onView: (event: CardEvent) => void;
  readonly controls: Controls | undefined;
  readonly current?: boolean;
  readonly origin?: "there" | "here" | "both" | undefined;
  readonly currentLabel: string;
  readonly baselineLabel: string;
  readonly currentFirst?: boolean;
  readonly editable?: boolean;
  readonly editing?: boolean;
  readonly gone?: string | undefined;
  readonly onEdit?: () => void;
  readonly onDone?: () => void;
  readonly seat?: () => Promise<EditorBook | undefined>;
  readonly analyze?: (text: string) => Analysis;
  readonly headerActions?: readonly CardAction[];
  readonly sideActions?: {
    readonly baseline: readonly CardAction[];
    readonly current: readonly CardAction[];
  };
  readonly below?: JSX.Element;
  readonly open?: CardAction;
  readonly onStep?: (step: ContextStep) => void;
  readonly onMounted?: (ms: number) => void;
}) {
  const [left, setLeft] = createSignal<HTMLDivElement | undefined>(undefined, { name: "cardLeft" });
  const [right, setRight] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "cardRight",
  });

  const markup = (): boolean => props.view.usfm;
  const usfm = (): boolean => props.usfm || markup();

  const now = () => untrack(() => ({ hunk: props.hunk, sides: props.sides }));
  const controls = (): Controls | undefined => {
    const held = untrack(() => props.controls);
    return held === undefined ? undefined : { ...held, gutter: false };
  };

  const currentPaint = (markup: boolean, split: boolean) => (): DiffPaint => {
    const { hunk, sides } = now();
    const mode = markup ? "usfm" : "default";
    return split
      ? sidePaint(hunk.all, "current", markup, controls(), sides.current)
      : hunkPaint(hunk.all, markup, controls(), wasBlock(sides.baseline, mode), sides.current);
  };
  const baselinePaint = (markup: boolean) => (): DiffPaint => {
    const { hunk, sides } = now();
    return sidePaint(hunk.all, "baseline", markup, undefined, sides.baseline);
  };

  const panes = new Map<"baseline" | "current", Pane>();

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
      const mount = untrack(() =>
        mountDiffView({
          parent: l,
          text,
          analyze: () => sides.baseline,
          mode: markup ? "usfm" : "default",
          clip: { from, to },
          surface: "cm-diff cm-diff-card",
          paint: paint(),
        }),
      );
      panes.set("baseline", { mount, paint, live: false });
      return () => {
        panes.delete("baseline");
        mount.destroy();
      };
    },
  );

  const [book, setBook] = createSignal<EditorBook | undefined>(undefined, { name: "cardBook" });
  const [refused, setRefused] = createSignal(false, { name: "cardRefused" });
  createEffect(
    () => props.editing === true,
    (editing) => {
      if (!editing) {
        setBook(undefined);
        return;
      }
      let current = true;
      void untrack(() => props.seat)?.().then((seated) => {
        if (!current) return;
        setBook(seated);
        setRefused(seated === undefined);
      });
      return () => {
        current = false;
      };
    },
  );
  const editingBook = (): EditorBook | undefined => (props.editing === true ? book() : undefined);

  const currentBuilt = createMemo(
    () => ({
      r: right(),
      split: props.split,
      markup: usfm(),
      decidable: props.controls !== undefined,
      text: props.sides.currentText,
      from: props.hunk.current.from,
      to: props.hunk.current.to,
      editing: props.editing === true,
    }),
    { name: "cardCurrentBuilt", equals: sameFields },
  );
  createEffect(
    () => currentBuilt(),
    ({ r, split, markup, editing }) => {
      if (r === undefined || editing) return;
      const started = performance.now();
      const { hunk, sides } = now();
      const paint = currentPaint(markup, split);
      const mount = untrack(() =>
        mountDiffView({
          parent: r,
          text: sides.currentText,
          analyze: () => sides.current,
          mode: markup ? "usfm" : "default",
          clip: hunk.current,
          surface: "cm-diff cm-diff-card",
          paint: paint(),
        }),
      );
      panes.set("current", { mount, paint, live: false });
      props.onMounted?.(performance.now() - started);
      return () => {
        panes.delete("current");
        mount.destroy();
      };
    },
  );

  createEffect(
    () => props.gone !== undefined,
    (gone) => {
      const pane = panes.get("current");
      if (gone && pane?.live === true) pane.mount.repaint({ lines: [], marks: [], controls: [] });
    },
  );

  const editorCard = (card: CardMount | undefined): void => {
    if (card === undefined) {
      panes.delete("current");
      return;
    }
    const paint = currentPaint(
      untrack(usfm),
      untrack(() => props.split),
    );
    panes.set("current", {
      mount: {
        repaint: (next) => card.setDiff(next),
        text: () => card.text(),
        length: () => card.length(),
      },
      paint,
      live: true,
    });
    untrack(() => card.setDiff(paint()));
  };

  createEffect(
    () => ({
      hunk: props.hunk,
      text: props.sides.currentText,
      decided: props.hunk.units.map((unit) => props.controls?.decision(unit) ?? "-").join(","),
    }),
    ({ text }) => {
      for (const pane of panes.values()) {
        if (pane.live) {
          if (pane.mount.length() !== text.length || pane.mount.text() !== text) continue;
        }
        untrack(() => pane.mount.repaint(pane.paint()));
      }
    },
  );

  const usfmAction = (): CardAction[] =>
    hunkKind(props.hunk.units) === undefined || props.usfm
      ? []
      : [
          {
            kind: "icon",
            id: "usfm",
            label: markup() ? t("Show the reading") : t("Show the USFM"),
            icon: CodeIcon,
            pressed: markup(),
            onPress: () => props.onView({ kind: "usfm" }),
          },
        ];

  const chosen = (): MergeSide | undefined => {
    const controls = props.controls;
    const units = props.hunk.units;
    if (controls === undefined || units.length === 0) return undefined;
    const sides = new Set(units.map((unit) => controls.decision(unit)));
    return sides.size === 1 ? [...sides][0] : undefined;
  };
  const caption = (side: MergeSide, label: string) => (
    <span
      class={cx(
        "flex min-w-0 items-center gap-1 truncate",
        chosen() === side && "font-medium text-brand",
      )}
      data-diff-chosen={chosen() === side ? "" : undefined}
    >
      <Show when={chosen() === side}>
        <CheckIcon size={12} aria-hidden="true" class="shrink-0" />
      </Show>
      <span class="truncate">{label}</span>
    </span>
  );

  const status = (): string => {
    const units = props.hunk.units;
    if (units.length === 0) return "";
    const controls = props.controls;
    if (controls !== undefined && units.every((unit) => controls.decision(unit) !== undefined))
      return "";
    if (units.length > 1) return `${units.length} changes`;
    const only = units[0]?.status ?? "";
    return only === "modified" ? "" : only;
  };

  return (
    <CardFrame
      data={{ "data-diff-card": props.hunk.key }}
      current={props.current === true}
      title={props.hunk.label}
      gone={props.gone}
      info={
        <>
          <span class="text-smallest text-on-surface-tertiary">{status()}</span>

          <Show when={props.origin}>
            {(origin) => (
              <span
                class={cx(
                  "text-smallest",
                  origin() === "both" ? "text-on-surface-warning" : "text-on-surface-tertiary",
                )}
                data-diff-origin={origin()}
              >
                {origin() === "there"
                  ? t("changed there")
                  : origin() === "here"
                    ? t("changed here")
                    : t("changed in both places")}
              </span>
            )}
          </Show>
          <Show when={hunkKind(props.hunk.units)}>
            {(kind) => (
              <span class="text-smallest text-on-surface-tertiary" data-diff-kind={kind()}>
                {kind()}
              </span>
            )}
          </Show>
        </>
      }
      headerActions={[...usfmAction(), ...(props.headerActions ?? [])]}
      edit={
        props.editable === true
          ? {
              kind: "edit",
              editing: props.editing === true,
              onEdit: () => props.onEdit?.(),
              onDone: () => props.onDone?.(),
            }
          : { kind: "none" }
      }
      open={props.open}
      context={
        <Show when={props.onStep}>
          {(step) => (
            <ContextControl
              extent={props.hunk.extent}
              canUp={props.hunk.more.up}
              canDown={props.hunk.more.down}
              only={t("Show only the change")}
              onStep={step()}
            />
          )}
        </Show>
      }
      onDblClick={() => {
        if (props.editing !== true && props.editable === true) props.onEdit?.();
      }}
    >
      <Show when={props.split}>
        <div class="grid grid-cols-2 divide-x divide-surface-border text-smallest text-on-surface-tertiary">
          <div
            class={cx(
              "flex min-w-0 items-center gap-2 px-3 py-0.5",
              props.currentFirst === true && "order-last",
            )}
          >
            {caption("baseline", props.baselineLabel)}
            <Show when={props.sideActions?.baseline.length}>
              <span class="ms-auto flex shrink-0 items-center gap-1">
                <CardActions actions={props.sideActions?.baseline ?? []} />
              </span>
            </Show>
          </div>
          <div class="flex min-w-0 items-center gap-2 px-3 py-0.5">
            {caption("current", props.currentLabel)}
            <Show when={props.sideActions?.current.length}>
              <span class="ms-auto flex shrink-0 items-center gap-1">
                <CardActions actions={props.sideActions?.current ?? []} />
              </span>
            </Show>
          </div>
        </div>
      </Show>
      <div class={props.split ? "grid grid-cols-2 divide-x divide-surface-border" : ""}>
        <Show when={props.split}>
          <div class={cx("min-w-0", props.currentFirst === true && "order-last")} ref={setLeft}>
            <Show when={props.hunk.baseline === undefined}>
              <p class="px-3 py-2 text-small text-on-surface-tertiary italic">
                {t("Not on this side.")}
              </p>
            </Show>
          </div>
        </Show>
        <Show when={props.editing === true} fallback={<div class="min-w-0" ref={setRight} />}>
          <div class="min-w-0">
            <Show
              when={editingBook()}
              fallback={
                <p class="px-3 py-2 text-small text-on-surface-tertiary">
                  {refused() ? t("That book could not be opened for editing.") : t("Opening…")}
                </p>
              }
            >
              {(seated) => (
                <CardEditor
                  book={seated()}
                  range={props.hunk.current}
                  policy={cardPolicy(usfm() ? "usfm" : "regular")}
                  surface="cm-diff cm-diff-card"
                  analyze={props.analyze ?? (() => props.sides.current)}
                  diff={currentPaint(
                    untrack(usfm),
                    untrack(() => props.split),
                  )()}
                  label={`review:${props.hunk.key}`}
                  reclip={false}
                  onEditor={editorCard}
                  onDone={() => props.onDone?.()}
                />
              )}
            </Show>
          </div>
        </Show>
      </div>
      {props.below}
    </CardFrame>
  );
}
