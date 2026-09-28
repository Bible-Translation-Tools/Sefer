/**
 * One change as a card: the diff view (`#editor` `mountDiffView`) CLIPPED to
 * the change and its context, so it reads exactly as the editor does —
 * regular mode or USFM, split (baseline beside current) or unified (the
 * current text with the baseline's words struck through where they were).
 *
 * It wears the frame every card wears (`multibuffer/CardFrame`) and edits the
 * way every card edits: read-only until Edit or a double-click, then the
 * current side is the Book itself (`multibuffer/CardEditor`) with the diff as
 * a plugin on it (`liveDiff`), repainted as the review compares again; Done or
 * Escape ends it. The list it sits in owns the edit session and the pin
 * (`multibuffer/CardList`).
 *
 * A card whose every change is formatting — markup or spacing, the words
 * identical — is drawn in USFM whatever the mode says: in the reading those
 * changes are invisible.
 */

import type { EditorView } from "@codemirror/view";
import type { JSX } from "@solidjs/web";
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";
import type { DecisionUnit } from "#core/galley/diff";
import {
  liveDiff,
  mountDiffView,
  mountStamp,
  repaintDiff,
  type DiffPaint,
  type DiffViewMount,
  type EditorBook,
} from "#editor/index";

import "#editor/editor.css";

import { t } from "../../i18n";
import { CardEditor } from "../multibuffer/CardEditor";
import { CardFrame } from "../multibuffer/CardFrame";
import { Badge, cx } from "../primitives";
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
  /** Whether the current side may be edited (Review's Result mode). */
  readonly editable?: boolean;
  /** The edit session, from the list (`CardList`). */
  readonly editing?: boolean;
  readonly gone?: string | undefined;
  readonly onEdit?: () => void;
  readonly onDone?: () => void;
  /** Plain → Instantiated for this card's book, when editing starts. */
  readonly seat?: () => Promise<EditorBook | undefined>;
  /** The current side's parse, for the editor (the review's own memo). */
  readonly analyze?: (text: string) => Analysis;
  /** Header actions, before Edit/Done: the card's decisions. */
  readonly headerActions?: JSX.Element;
  /** The open control (to the whole book). */
  readonly open?: JSX.Element;
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

  // The edit session's book: seated when editing starts, let go when it ends.
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

  // The current pane, read-only: rebuilt when its own text or stretch does,
  // and not at all while the card is being edited — then the pane is the Book.
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
      const mount = mountDiffView({
        parent: r,
        text: sides.currentText,
        analyze: () => sides.current,
        mode: markup ? "usfm" : "default",
        clip: hunk.current,
        surface: "cm-diff cm-diff-card",
        paint: paint(),
      });
      panes.set("current", { mount, paint, live: false });
      props.onMounted?.(performance.now() - started);
      return () => {
        panes.delete("current");
        mount.destroy();
      };
    },
  );

  // Edited back to exactly the other side's text: no change is left, so the
  // live pane shows none.
  createEffect(
    () => props.gone !== undefined,
    (gone) => {
      const pane = panes.get("current");
      if (gone && pane?.live === true)
        pane.mount.repaint({ lines: [], marks: [], widgets: [], controls: [] });
    },
  );

  /** The editor, registered as the live current pane so a comparison repaints it. */
  const editorView = (view: EditorView | undefined): void => {
    if (view === undefined) {
      panes.delete("current");
      return;
    }
    const paint = currentPaint(
      untrack(usfm),
      untrack(() => props.split),
    );
    panes.set("current", {
      mount: {
        view,
        repaint: (next) => repaintDiff(view, next),
        setMode: () => {},
        showAt: () => {},
        destroy: () => {},
      },
      paint,
      live: true,
    });
    repaintDiff(view, paint());
  };

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
        // A live pane is painted only by a comparison of EXACTLY the text it
        // holds: one taken a keystroke earlier puts marks at offsets the typing
        // has moved. Length alone is not enough — a same-length edit passes it.
        if (pane.live) {
          const doc = pane.mount.view.state.doc;
          if (doc.length !== text.length || doc.toString() !== text) continue;
        }
        pane.mount.repaint(pane.paint());
      }
    },
  );

  const status = (): string =>
    props.hunk.units.length === 1
      ? (props.hunk.units[0]?.status ?? "")
      : `${props.hunk.units.length} changes`;

  return (
    <CardFrame
      data={{ "data-diff-card": props.hunk.key }}
      label={hunkLabel(props.hunk)}
      gone={props.gone}
      badges={
        <>
          <span class="text-smallest text-on-surface-tertiary">{status()}</span>
          <Show when={hunkKind(props.hunk.units)}>
            {(kind) => (
              <Badge tone="muted" data-diff-kind={kind()}>
                {kind()}
              </Badge>
            )}
          </Show>
        </>
      }
      headerActions={props.headerActions}
      editable={props.editable === true}
      editing={props.editing === true}
      onEdit={() => props.onEdit?.()}
      onDone={() => props.onDone?.()}
      open={props.open}
      // Double-click edits, as on every card; a card that cannot be edited
      // does nothing — the book icon is the one way into the whole book, so a
      // gesture never takes the reader somewhere else.
      onDblClick={() => {
        if (props.editing !== true && props.editable === true) props.onEdit?.();
      }}
    >
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
                  mode={usfm() ? "usfm" : "regular"}
                  surface="cm-diff cm-diff-card"
                  analyze={props.analyze ?? (() => props.sides.current)}
                  extensions={liveDiff(
                    currentPaint(
                      untrack(usfm),
                      untrack(() => props.split),
                    )(),
                  )}
                  label={`review:${props.hunk.key}`}
                  reclip={false}
                  onView={editorView}
                  onDone={() => props.onDone?.()}
                />
              )}
            </Show>
          </div>
        </Show>
      </div>
    </CardFrame>
  );
}
