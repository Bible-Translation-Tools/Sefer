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
 * turns it into decorations and never reads the diff itself. Three kinds:
 *
 *  - `lines`: a unit's tint, a class over its text (a mark, not a line
 *    class: see `decorate`).
 *  - `marks`: a class on a range — a changed word.
 *  - `widgets`: something drawn at a position that is not in this text — a
 *    removed word inline, or a removed unit as a block (the caller builds its
 *    DOM; a stamp of the other text is the usual answer).
 *
 * Plus a gutter of per-unit controls, whose DOM is the caller's too.
 */

import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Compartment, EditorState } from "@codemirror/state";
import {
  BlockType,
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  WidgetType,
  gutter,
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

export interface DiffWidget {
  readonly at: number;
  /** A whole block between lines, rather than inline at `at`. */
  readonly block: boolean;
  /** Stable while the widget means the same thing, so a repaint keeps the DOM. */
  readonly key: string;
  readonly render: () => HTMLElement;
}

export interface DiffControl {
  /** Where the unit starts, in this text. The gutter marker sits on that line. */
  readonly at: number;
  readonly key: string;
  readonly render: () => HTMLElement;
}

export interface DiffPaint {
  readonly lines: readonly { readonly from: number; readonly to: number; readonly class: string }[];
  readonly marks: readonly { readonly from: number; readonly to: number; readonly class: string }[];
  readonly widgets: readonly DiffWidget[];
  readonly controls: readonly DiffControl[];
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
  /** Brings the line holding `at` to the top — how a split's other pane follows. */
  showAt(at: number): void;
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
  for (const widget of paint.widgets) {
    const at = Math.min(widget.at, doc.length);
    // A block goes AFTER the line holding `at` — the caller names the end of
    // what the block follows — except at the very start of the text.
    const place = widget.block ? (at === 0 ? 0 : doc.lineAt(at).to) : at;
    ranges.push({
      from: place,
      to: place,
      deco: Decoration.widget({
        widget: new Built(widget.key, widget.render),
        block: widget.block,
        side: widget.block && at === 0 ? -1 : 1,
      }),
    });
  }
  return Decoration.set(
    ranges.map((range) => range.deco.range(range.from, range.to)),
    true,
  );
};

const paintField = StateField.define<{ paint: DiffPaint; set: DecorationSet }>({
  create: () => ({
    paint: { lines: [], marks: [], widgets: [], controls: [] },
    set: Decoration.none,
  }),
  update(held, tr) {
    for (const effect of tr.effects)
      if (effect.is(setPaint))
        return { paint: effect.value, set: decorate(tr.state, effect.value) };
    if (!tr.docChanged) return held;
    // Mapped through the edit, and a WORD mark whose own text the edit touched
    // is dropped at once — the change it described is what the reader is now
    // rewriting. The next comparison paints what is true. A unit's tint maps
    // with the edit (dropping it would flash the verse on every keystroke),
    // and widgets are anchored between texts and stay.
    const touched: { from: number; to: number }[] = [];
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) =>
      touched.push({ from: fromB, to: toB }),
    );
    return {
      ...held,
      set: held.set.map(tr.changes).update({
        filter: (from, to, value) =>
          !WORD_MARKS.has(String(value.spec.class)) ||
          !touched.some((range) => range.from <= to && range.to >= from),
      }),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (held) => held.set),
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
 * Result mode, where the text being compared is the text being edited. Its
 * decorations map through every edit until the next comparison repaints them
 * (`repaintDiff`).
 */
export const liveDiff = (paint: DiffPaint): Extension[] => [
  paintField.init((state) => ({ paint, set: decorate(state, paint) })),
  controlGutter(),
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
      paintField.init((state) => ({ paint: options.paint, set: decorate(state, options.paint) })),
      controlGutter(),
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
    showAt: (at) => {
      view.dispatch({
        effects: EditorView.scrollIntoView(Math.min(at, view.state.doc.length), { y: "start" }),
      });
    },
    destroy: () => {
      if (clip === undefined) view.destroy();
      else giveBack(view);
    },
  };
}
