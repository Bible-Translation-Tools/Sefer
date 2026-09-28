/**
 * A diff drawn INSIDE the editor's own reading: one whole text, painted the
 * way the editor paints it, with a decision-unit diff laid over it.
 *
 * Not CodeMirror's merge view. That is a line differ, and a line is not what
 * changed in scripture — a verse is, or three words of one. The diff here is
 * the engine's (`galley.diff`): decision units with a span in each side's own
 * document, and word runs inside a modified unit. Nothing is synthesized: each
 * side is its own real text, and the diff is only decoration on it, so the
 * reading flows exactly as it does in the editor — paragraphs stay
 * paragraphs, poetry stays indented, a changed word is marked where it sits.
 *
 * The caller describes what to paint (`DiffPaint`) in plain offsets; this file
 * turns it into decorations and never reads the diff itself:
 *
 *  - `lines`: a unit's tint, a class over its text (a mark, not a line
 *    class: see `decorate`).
 *  - `marks`: a class on a range — a changed word.
 *  - `hunks`: a one-text view's units, drawn as Zed draws hunks (`DiffHunk`).
 *
 * Plus a gutter of per-unit controls, whose DOM is the caller's too. (Words
 * struck inline where they were, and a removed unit as a block between lines,
 * were tried and dropped on 2026-09-28: noise in the text being edited.)
 */

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

import type { Analysis } from "#core/galley";

import { type Analyze, analyzer } from "../core/analyzer";
import { readingLayer, viewLayer } from "../core/compose";
import { borrowedStructure, structureAt, type DocStructure } from "../core/docStructure";
import { renderRangeField } from "../core/render";
import { span } from "../core/timing";
import { modeView, type ProjectionName } from "../views";
import { clipped, wholeLinesOf } from "./satellite";
import { giveBack, takeView } from "./viewPool";

/**
 * The editor structure first built over each parse, lent to every later diff
 * view of it: forty cards over one book build it once, not forty times.
 */
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

export interface DiffViewMount {
  readonly view: EditorView;
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
    readonly make: () => HTMLElement,
  ) {
    super();
  }
  override eq(other: Control): boolean {
    return other.key === this.key;
  }
  override toDOM(): HTMLElement {
    return this.make();
  }
}

const setPaint = StateEffect.define<DiffPaint>();
/** Opens or closes one hunk, by key. */
const toggleHunk = StateEffect.define<string>();

/** The marks on changed WORDS, as `paint.ts` names them — the ones an edit can end. */
const WORD_MARKS = new Set(["cm-diff-added", "cm-diff-removed"]);

/**
 * Where the line holding `at` starts ON SCREEN. Usually its line block's
 * start; but in a clipped card the text before the clip is a replaced range,
 * and a verse that starts mid-paragraph shares one block with it — so the
 * block's start is inside what is hidden, and a line class or a gutter marker
 * placed there is never drawn. The text piece of the block is what is shown.
 */
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
  // The unit tints, as marks over the unit's own text rather than classes on
  // lines. In the reading a paragraph is ONE visual line, so a line class
  // tinted every verse in it when one had changed; and a card clipped
  // mid-paragraph starts that line inside the hidden text, where a line class
  // is never drawn at all. A mark is exactly the unit, wherever it sits.
  // Clamped to the text: over a live document, a paint can be one comparison
  // behind the keystroke that just landed.
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

/** What the hunks draw: every hunk's changed words; an open one's tint and the other side's wording. */
const decorateHunks = (
  state: EditorState,
  hunks: readonly DiffHunk[],
  open: ReadonlySet<string>,
): DecorationSet => {
  const doc = state.doc.length;
  const ranges: ReturnType<Decoration["range"]>[] = [];
  for (const hunk of hunks) {
    if (!open.has(hunk.key) || hunk.from > doc) continue;
    // Open: the other side's wording at the unit, and the unit tinted.
    if (hunk.old !== undefined) {
      const render = hunk.old;
      // A unit this text lacks is a point, often the start of the next
      // source line — which a clipped card hides, and in the reading is the
      // next verse's line anyway. Drawn at the end of the line before it
      // instead: the same place on screen, and inside what the card shows.
      const atLineStart =
        hunk.from === hunk.to &&
        hunk.from > 0 &&
        state.doc.sliceString(hunk.from - 1, hunk.from) === "\n";
      const place = atLineStart ? hunk.from - 1 : hunk.from;
      // Inline at the unit, drawn as a block: the paragraph breaks at this
      // verse rather than above the whole paragraph (a `\p` can hold thirty
      // verses), and it moves the text only when somebody asks for it.
      ranges.push(
        Decoration.widget({
          widget: new Built(`was ${hunk.key}`, () => {
            const box = document.createElement("div");
            box.className = "cm-diff-was-box";
            box.dataset["diffWas"] = hunk.key;
            box.append(render());
            return box;
          }),
          // Before whatever starts here: at a line's end that is the clip's
          // hidden rest, which would swallow a widget drawn after it.
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
  /** The paint's own decorations, mapped through any typing since. */
  readonly set: DecorationSet;
  /** The paint's hunks, their offsets mapped through any typing since. */
  readonly hunks: readonly DiffHunk[];
  readonly open: ReadonlySet<string>;
  readonly opened: DecorationSet;
}

const painted = (state: EditorState, paint: DiffPaint, open: ReadonlySet<string>): Painted => {
  const hunks = paint.hunks ?? [];
  // A repaint keeps what the reader had open, while that unit is still there.
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
    // Mapped through the edit, and a WORD mark whose own text the edit touched
    // is dropped at once — the change it described is what the reader is now
    // rewriting. The next comparison paints what is true. A unit's tint maps
    // with the edit (dropping it would flash the verse on every keystroke),
    // and an opened hunk's wording is anchored at its unit and stays.
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
      })),
      opened: held.opened.map(tr.changes).update({ filter: keep }),
    };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (held) => held.set),
    EditorView.decorations.from(field, (held) => held.opened),
  ],
});

/** A hunk's bar, beside its own rows; its key names what a click opens. */
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

/** How far left of the text a bar's hit area starts, and how wide it is. */
const BAR_OFFSET = 11;

/**
 * The bars: drawn per UNIT, from the row its first character is on to the
 * row its last is on. Not gutter markers, which mark whole lines — in the
 * reading a paragraph is one line, and in USFM verses may share a line too, so
 * a line cannot say which verse changed. Measured the way CodeMirror measures
 * the selection, again whenever the text re-wraps.
 */
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
      // A unit this text lacks sits at a point, and in a clipped card that
      // point can be the clip's own end, which has no coordinates after it:
      // then the row it ends, before it.
      const start =
        view.coordsAtPos(at, 1) ??
        (hunk.from === hunk.to
          ? (view.coordsAtPos(at, -1) ?? (at > 0 ? view.coordsAtPos(at - 1, -1) : null))
          : null);
      if (start === null) continue;
      // On the unit's LAST CHARACTER, not after it: another unit's opened
      // wording can be drawn right at this unit's end, and the position after
      // the last character would measure that block instead.
      const end =
        hunk.to > hunk.from
          ? view.coordsAtPos(Math.min(hunk.to, view.state.doc.length) - 1, 1)
          : null;
      // Open, the bar spans the other side's wording too, as Zed's spans the
      // old lines and the new.
      const was = open.has(hunk.key)
        ? view.contentDOM.querySelector(`[data-diff-was="${CSS.escape(hunk.key)}"]`)
        : null;
      const top = Math.min(start.top, was?.getBoundingClientRect().top ?? start.top);
      const bottom = Math.max((end ?? start).bottom, was?.getBoundingClientRect().bottom ?? 0);
      spans.push({ hunk, top, bottom: Math.max(bottom, top + (hunk.from === hunk.to ? 8 : 4)) });
    }
    // Two verses can share a row (one ends where the next begins): each takes
    // its half of it, so the bars never run together. Units this text lacks
    // are points, and several at one place (a run of deleted verses) stack as
    // separate ticks rather than halving each other away.
    spans.sort((a, b) => a.top - b.top);
    // An OPENED point spans its wording, like any open hunk.
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

/**
 * A click on a bar, or on a changed verse's number, opens or closes it. In
 * the capture phase on the scroller: the bars are outside the content, and a
 * click on a verse number must not also put the caret there.
 */
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
      key = hunks.find((hunk) => hunk.from <= at && at <= Math.max(hunk.to, hunk.from + 1))?.key;
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
    // Markers are asked again when the paint changes, not only when the
    // document or the viewport does.
    lineMarkerChange: (update) =>
      update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setPaint))),
    markers: (view) => {
      const builder = new RangeSetBuilder<GutterMarker>();
      const doc = view.state.doc;
      const seen = new Set<number>();
      const controls = [...view.state.field(paintField).paint.controls].sort((a, b) => a.at - b.at);
      for (const control of controls) {
        // At the VISUAL line's start: the gutter draws a marker only where a
        // line block begins, and in regular mode a unit's first source line
        // (a bare `\q1`) is folded into the line it introduces.
        const from = visualStart(view, Math.min(control.at, doc.length));
        if (seen.has(from)) continue;
        seen.add(from);
        builder.add(from, from, new Control(control.key, control.render));
      }
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
  const clip = options.clip === undefined ? undefined : wholeLinesOf(options.text, options.clip);

  const state = EditorState.create({
    doc: options.text,
    extensions: [
      analyzer.of(options.analyze),
      borrowedStructure.of(() => lent.get(options.analyze(options.text)) ?? null),
      readingLayer,
      viewLayer(),
      projection.of(modeView(options.mode, surface)),
      ...(clip === undefined ? [] : [clipped(clip), renderRangeField.init(() => clip)]),
      // Seeded with the first paint, so the gutter's first pass has markers.
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
  // Clipped cards come and go as a list scrolls; they take a pooled view.
  const view =
    clip === undefined ? new EditorView({ state, parent: options.parent }) : takeView(state);
  if (clip !== undefined) options.parent.appendChild(view.dom);
  done();

  return {
    view,
    repaint: (paint) => view.dispatch({ effects: setPaint.of(paint) }),
    setMode: (mode) => view.dispatch({ effects: projection.reconfigure(modeView(mode, surface)) }),
    showAt: (at, y = "start") => {
      view.dispatch({
        effects: EditorView.scrollIntoView(Math.min(at, view.state.doc.length), { y }),
      });
    },
    destroy: () => {
      if (clip === undefined) view.destroy();
      else giveBack(view);
    },
  };
}
