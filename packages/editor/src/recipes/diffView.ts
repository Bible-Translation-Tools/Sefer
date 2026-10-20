import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Compartment, EditorState } from "@codemirror/state";
import {
  BlockType,
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  type LayerMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  layer,
} from "@codemirror/view";
import type { Analysis } from "@sefer/text/engine/analysis";

import { type Analyze, analyzer } from "../core/analyzer";
import { readingLayer, viewLayer } from "../core/compose";
import { borrowedStructure, structureAt, type DocStructure } from "../core/docStructure";
import { renderRangeField } from "../core/render";
import { span } from "../core/timing";
import { handleFor, markMoved, type EditorHandle } from "../handle";
import { modeView, type ProjectionName } from "../views";
import { clipSpanOf, clipped, wholeLinesOf } from "./satellite";
import { giveBack, takeView } from "./viewPool";

const lent = new WeakMap<Analysis, DocStructure>();

export interface DiffControl {
  /** Where the unit starts, in this text. The gutter marker sits on that line. */
  readonly at: number;
  readonly key: string;
  readonly render: () => HTMLElement;
}

/**
 * One changed unit in a one-text view drawn the way Zed draws a hunk: the text
 * as it reads now, a bar beside the unit's own rows, and nothing else until
 * the reader opens it — then the unit is tinted, its changed words marked,
 * and the other side's wording (`old`) opens at the unit, read-only. The
 * final text is what is reviewed; the change is there when asked for.
 */
export interface DiffHunk {
  /** Stable while the unit is (its id): what stays open across a repaint. */
  readonly key: string;
  /** The bar's colour. `decided` is a unit that reads as a side it was decided for. */
  readonly kind: "added" | "deleted" | "modified" | "decided";
  /** The unit's text here, or a point (`from === to`) for one this text lacks. */
  readonly from: number;
  readonly to: number;
  /** While open: the class over the unit's text. */
  readonly tint: string;
  /** Its changed words — drawn open or closed: what the text gained is part of the text. */
  readonly marks: readonly { readonly from: number; readonly to: number; readonly class: string }[];
  /** While open: the other side's wording, drawn at `from`. */
  readonly old?: () => HTMLElement;
  /** What the bar's tooltip says of it: "Changed 3:5". */
  readonly label?: string;
}

export interface DiffPaint {
  readonly lines: readonly { readonly from: number; readonly to: number; readonly class: string }[];
  readonly marks: readonly { readonly from: number; readonly to: number; readonly class: string }[];
  readonly controls: readonly DiffControl[];
  /** Units drawn as Zed hunks (bars, opened on request), for a one-text view. */
  readonly hunks?: readonly DiffHunk[];
}

export interface DiffViewOptions {
  readonly parent: HTMLElement;
  readonly text: string;
  readonly analyze: Analyze;
  readonly mode: ProjectionName;
  readonly paint: DiffPaint;
  /**
   * Show only this range, in source offsets — a change and its context, as a
   * card in a list of them. The satellite's own clip (`clipped`), so the card
   * reads and scrolls like every other excerpt; absent, the whole text.
   */
  readonly clip?: { readonly from: number; readonly to: number } | undefined;
  /** The stylesheet's name for the surface; `cm-diff` unless a card asks for its own. */
  readonly surface?: string;
}

export interface DiffViewMount extends EditorHandle {
  repaint(paint: DiffPaint): void;
  setMode(mode: ProjectionName): void;
  /**
   * Brings the line holding `at` into view: to the top, or to the middle — how
   * next / previous change puts the same unit before the reader in each pane.
   */
  showAt(at: number, y?: "start" | "center"): void;
  destroy(): void;
}

class Built extends WidgetType {
  constructor(
    readonly key: string,
    readonly make: () => HTMLElement,
  ) {
    super();
  }
  override eq(other: Built): boolean {
    return other.key === this.key;
  }
  toDOM(): HTMLElement {
    return this.make();
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class Control extends GutterMarker {
  constructor(
    readonly key: string,
    readonly make: readonly (() => HTMLElement)[],
  ) {
    super();
  }
  override eq(other: Control): boolean {
    return other.key === this.key;
  }
  override toDOM(): HTMLElement {
    if (this.make.length === 1 && this.make[0] !== undefined) return this.make[0]();
    const stack = document.createElement("span");
    stack.className = "cm-diff-control-stack";
    for (const make of this.make) stack.append(make());
    return stack;
  }
}

const setPaint = StateEffect.define<DiffPaint>();
const toggleHunk = StateEffect.define<string>();

const WORD_MARKS = new Set(["cm-diff-added", "cm-diff-removed"]);

const visualStart = (view: EditorView, at: number): number => {
  const block = view.lineBlockAt(at);
  if (!Array.isArray(block.type)) return block.from;
  let from = block.from;
  for (const piece of block.type)
    if (piece.type === BlockType.Text && piece.from <= at) from = piece.from;
  return from;
};

const decorate = (state: EditorState, paint: DiffPaint): DecorationSet => {
  const doc = state.doc;
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  for (const line of paint.lines)
    if (line.to > line.from && line.from < doc.length)
      ranges.push({
        from: line.from,
        to: Math.min(line.to, doc.length),
        deco: Decoration.mark({ class: line.class }),
      });
  for (const mark of paint.marks)
    if (mark.to > mark.from && mark.to <= doc.length)
      ranges.push({ from: mark.from, to: mark.to, deco: Decoration.mark({ class: mark.class }) });
  return Decoration.set(
    ranges.map((range) => range.deco.range(range.from, range.to)),
    true,
  );
};

const decorateHunks = (
  state: EditorState,
  hunks: readonly DiffHunk[],
  open: ReadonlySet<string>,
): DecorationSet => {
  const doc = state.doc.length;
  const ranges: ReturnType<Decoration["range"]>[] = [];
  for (const hunk of hunks) {
    if (!open.has(hunk.key) || hunk.from > doc) continue;
    if (hunk.old !== undefined) {
      const render = hunk.old;
      const atLineStart =
        hunk.from === hunk.to &&
        hunk.from > 0 &&
        state.doc.sliceString(hunk.from - 1, hunk.from) === "\n";
      const place = atLineStart ? hunk.from - 1 : hunk.from;
      ranges.push(
        Decoration.widget({
          widget: new Built(`was ${hunk.key}`, () => {
            const box = document.createElement("div");
            box.className = "cm-diff-was-box";
            box.dataset["diffWas"] = hunk.key;
            box.append(render());
            return box;
          }),
          side: -1,
        }).range(place),
      );
    }
    if (hunk.to > hunk.from && hunk.tint !== "")
      ranges.push(Decoration.mark({ class: hunk.tint }).range(hunk.from, Math.min(hunk.to, doc)));
  }
  for (const hunk of hunks)
    for (const mark of hunk.marks)
      if (mark.to > mark.from && mark.to <= doc)
        ranges.push(Decoration.mark({ class: mark.class }).range(mark.from, mark.to));
  return Decoration.set(ranges, true);
};

interface Painted {
  readonly paint: DiffPaint;
  readonly set: DecorationSet;
  readonly hunks: readonly DiffHunk[];
  readonly open: ReadonlySet<string>;
  readonly opened: DecorationSet;
}

const painted = (state: EditorState, paint: DiffPaint, open: ReadonlySet<string>): Painted => {
  const hunks = paint.hunks ?? [];
  const kept = new Set(hunks.filter((hunk) => open.has(hunk.key)).map((hunk) => hunk.key));
  return {
    paint,
    set: decorate(state, paint),
    hunks,
    open: kept,
    opened: decorateHunks(state, hunks, kept),
  };
};

const paintField = StateField.define<Painted>({
  create: (state) => painted(state, { lines: [], marks: [], controls: [] }, new Set<string>()),
  update(held, tr) {
    let next = held;
    for (const effect of tr.effects) {
      if (effect.is(setPaint)) next = painted(tr.state, effect.value, next.open);
      if (effect.is(toggleHunk)) {
        const open = new Set(next.open);
        if (open.has(effect.value)) open.delete(effect.value);
        else open.add(effect.value);
        next = { ...next, open, opened: decorateHunks(tr.state, next.hunks, open) };
      }
    }
    if (next !== held || !tr.docChanged) return next;
    const touched: { from: number; to: number }[] = [];
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) =>
      touched.push({ from: fromB, to: toB }),
    );
    const keep = (from: number, to: number, value: Decoration): boolean =>
      !WORD_MARKS.has(String(value.spec.class)) ||
      !touched.some((range) => range.from <= to && range.to >= from);
    return {
      ...held,
      set: held.set.map(tr.changes).update({ filter: keep }),
      hunks: held.hunks.map((hunk) => ({
        ...hunk,
        from: tr.changes.mapPos(hunk.from, -1),
        to: tr.changes.mapPos(hunk.to, 1),
        marks: hunk.marks
          .map((mark) => ({
            ...mark,
            from: tr.changes.mapPos(mark.from, 1),
            to: tr.changes.mapPos(mark.to, -1),
          }))
          .filter(
            (mark) =>
              mark.to > mark.from &&
              !touched.some((range) => range.from <= mark.to && range.to >= mark.from),
          ),
      })),
      opened: held.opened.map(tr.changes).update({ filter: keep }),
    };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (held) => held.set),
    EditorView.decorations.from(field, (held) => held.opened),
  ],
});

class Bar implements LayerMarker {
  constructor(
    readonly key: string,
    readonly kind: DiffHunk["kind"],
    readonly label: string,
    readonly open: boolean,
    readonly left: number,
    readonly top: number,
    readonly height: number,
  ) {}
  draw(): HTMLElement {
    const bar = document.createElement("div");
    bar.dataset["diffBar"] = this.key;
    this.adjust(bar);
    return bar;
  }
  update(dom: HTMLElement, previous: LayerMarker): boolean {
    if (!(previous instanceof Bar) || previous.key !== this.key) return false;
    this.adjust(dom);
    return true;
  }
  eq(other: LayerMarker): boolean {
    return (
      other instanceof Bar &&
      other.key === this.key &&
      other.kind === this.kind &&
      other.label === this.label &&
      other.open === this.open &&
      other.left === this.left &&
      other.top === this.top &&
      other.height === this.height
    );
  }
  private adjust(bar: HTMLElement): void {
    bar.className = `cm-diff-bar cm-diff-bar-${this.kind}`;
    const what = this.open ? "hide the other side's wording" : "show the other side's wording";
    bar.title = this.label === "" ? what : `${this.label} — click to ${what}`;
    if (this.open) bar.dataset["open"] = "";
    else delete bar.dataset["open"];
    bar.style.left = `${this.left}px`;
    bar.style.top = `${this.top}px`;
    bar.style.height = `${this.height}px`;
  }
}

const BAR_OFFSET = 11;

function settleOverlaps(
  spans: { hunk: DiffHunk; top: number; bottom: number }[],
  open: ReadonlySet<string>,
): void {
  const point = (entry: { hunk: DiffHunk }): boolean =>
    entry.hunk.from === entry.hunk.to && !open.has(entry.hunk.key);
  for (let index = 1; index < spans.length; index++) {
    const before = spans[index - 1];
    const after = spans[index];
    if (before === undefined || after === undefined || after.top >= before.bottom) continue;
    if (point(after)) {
      const height = after.bottom - after.top;
      after.top = before.bottom + 2;
      after.bottom = after.top + height;
      continue;
    }
    const middle = (after.top + Math.min(before.bottom, after.bottom)) / 2;
    before.bottom = middle;
    after.top = middle;
  }
}

const barLayer = layer({
  above: true,
  class: "cm-diff-bars",
  update: (update) =>
    update.docChanged ||
    update.viewportChanged ||
    update.geometryChanged ||
    update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(setPaint) || effect.is(toggleHunk)),
    ),
  markers: (view) => {
    const { hunks, open } = view.state.field(paintField);
    if (hunks.length === 0) return [];
    const scroller = view.scrollDOM.getBoundingClientRect();
    const baseLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
    const baseTop = scroller.top - view.scrollDOM.scrollTop * view.scaleY;
    const content = view.contentDOM.getBoundingClientRect();
    const pad = Number.parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
    const left = Math.max(0, (content.left - baseLeft) / view.scaleX + pad - BAR_OFFSET);
    const { from: shownFrom, to: shownTo } = view.viewport;
    const spans: { hunk: DiffHunk; top: number; bottom: number }[] = [];
    for (const hunk of hunks) {
      if (hunk.to < shownFrom || hunk.from > shownTo) continue;
      const at = Math.min(hunk.from, view.state.doc.length);
      const start =
        view.coordsAtPos(at, 1) ??
        (hunk.from === hunk.to
          ? (view.coordsAtPos(at, -1) ?? (at > 0 ? view.coordsAtPos(at - 1, -1) : null))
          : null);
      if (start === null) continue;
      const end =
        hunk.to > hunk.from
          ? view.coordsAtPos(Math.min(hunk.to, view.state.doc.length) - 1, 1)
          : null;
      const was = open.has(hunk.key)
        ? view.contentDOM.querySelector(`[data-diff-was="${CSS.escape(hunk.key)}"]`)
        : null;
      const top = Math.min(start.top, was?.getBoundingClientRect().top ?? start.top);
      const bottom = Math.max((end ?? start).bottom, was?.getBoundingClientRect().bottom ?? 0);
      spans.push({ hunk, top, bottom: Math.max(bottom, top + (hunk.from === hunk.to ? 8 : 4)) });
    }
    spans.sort((a, b) => a.top - b.top);
    settleOverlaps(spans, open);
    const out: Bar[] = [];
    for (const { hunk, top, bottom } of spans)
      out.push(
        new Bar(
          hunk.key,
          hunk.kind,
          hunk.label ?? "",
          open.has(hunk.key),
          left,
          (top - baseTop) / view.scaleY,
          (bottom - top) / view.scaleY,
        ),
      );
    return out;
  },
});

const hunkClicks = ViewPlugin.define((view) => {
  const onDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const { hunks } = view.state.field(paintField);
    if (hunks.length === 0) return;
    let key = event.target.closest<HTMLElement>("[data-diff-bar]")?.dataset["diffBar"];
    if (key === undefined) {
      const number = event.target.closest(".usfm-num-v");
      if (number === null || !view.contentDOM.contains(number)) return;
      const at = view.posAtDOM(number);
      key = (
        hunks.find((hunk) => hunk.from === at && hunk.to > hunk.from) ??
        hunks.find((hunk) => hunk.from < at && at < hunk.to)
      )?.key;
    }
    if (key === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    view.dispatch({ effects: toggleHunk.of(key) });
  };
  view.scrollDOM.addEventListener("mousedown", onDown, true);
  return {
    destroy: () => view.scrollDOM.removeEventListener("mousedown", onDown, true),
  };
});

const controlGutter = (): Extension =>
  gutter({
    class: "cm-diff-controls",
    lineMarkerChange: (update) =>
      update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setPaint))),
    markers: (view) => {
      const builder = new RangeSetBuilder<GutterMarker>();
      const doc = view.state.doc;
      const lines = new Map<number, DiffControl[]>();
      const controls = [...view.state.field(paintField).paint.controls].sort((a, b) => a.at - b.at);
      for (const control of controls) {
        const from = visualStart(view, Math.min(control.at, doc.length));
        const held = lines.get(from);
        if (held === undefined) lines.set(from, [control]);
        else held.push(control);
      }
      for (const [from, held] of [...lines].sort((a, b) => a[0] - b[0]))
        builder.add(
          from,
          from,
          new Control(
            held.map((control) => control.key).join("|"),
            held.map((control) => control.render),
          ),
        );
      return builder.finish();
    },
  });

/**
 * The diff as a plugin on ANY editor — the book's own satellite, in Review's
 * an editable review, where the text being compared is the text being edited. Its
 * decorations map through every edit until the next comparison repaints them
 * (`repaintDiff`).
 */
export const liveDiff = (paint: DiffPaint): Extension[] => [
  paintField.init((state) => painted(state, paint, new Set<string>())),
  controlGutter(),
  barLayer,
  hunkClicks,
];

export const repaintDiff = (view: EditorView, paint: DiffPaint): void => {
  view.dispatch({ effects: setPaint.of(paint) });
};

export function mountDiffView(options: DiffViewOptions): DiffViewMount {
  const done = span("diff-mount", `${(options.text.length / 1024) | 0}KB`);
  const projection = new Compartment();
  const surface = options.surface ?? "cm-diff";
  const clip = options.clip === undefined ? undefined : clipSpanOf(options.text, options.clip);

  const state = EditorState.create({
    doc: options.text,
    extensions: [
      analyzer.of(options.analyze),
      borrowedStructure.of(() => lent.get(options.analyze(options.text)) ?? null),
      readingLayer,
      viewLayer(),
      projection.of(modeView(options.mode, surface)),
      ...(clip === undefined
        ? []
        : [clipped(clip), renderRangeField.init(() => wholeLinesOf(options.text, clip))]),
      paintField.init((state) => painted(state, options.paint, new Set<string>())),
      controlGutter(),
      barLayer,
      hunkClicks,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  });
  const parsed = options.analyze(options.text);
  if (!lent.has(parsed)) lent.set(parsed, structureAt(state));
  const view =
    clip === undefined ? new EditorView({ state, parent: options.parent }) : takeView(state);
  if (clip !== undefined) options.parent.appendChild(view.dom);
  done();

  return handleFor(view, {
    repaint: (paint: DiffPaint) => view.dispatch({ effects: setPaint.of(paint) }),
    setMode: (mode: ProjectionName) =>
      view.dispatch({ effects: projection.reconfigure(modeView(mode, surface)) }),
    showAt: (at: number, y: "start" | "center" = "start") => {
      markMoved(view);
      view.dispatch({
        effects: EditorView.scrollIntoView(Math.min(at, view.state.doc.length), { y }),
      });
    },
    destroy: () => {
      if (clip === undefined) view.destroy();
      else giveBack(view);
    },
  });
}
