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
 *  - `lines`: a class on every line a range touches — the unit's tint.
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
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  gutter,
} from "@codemirror/view";

import { type Analyze, analyzer } from "../core/analyzer";
import { readingLayer, viewLayer } from "../core/compose";
import { span } from "../core/timing";
import { modeView, type ProjectionName } from "../views";

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

/**
 * The unit tints, as line decorations on VISUAL lines.
 *
 * A view plugin and not part of the state field, because where a visual line
 * starts is the view's answer: in regular mode the bare `\q1` a verse opens
 * with is drawn as the start of that verse's line, and it belongs to the unit
 * BEFORE (a unit's extent runs to the next unit's marker). A line class placed
 * on the verse's own source line is dropped — it does not start a line on
 * screen — so each source line of a range is lifted to the block it is drawn in.
 */
const tints = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      const repainted = update.transactions.some(
        (tr) => tr.reconfigured || tr.effects.some((effect) => effect.is(setPaint)),
      );
      if (update.docChanged || repainted) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const doc = view.state.doc;
      const starts = new Map<number, string>();
      for (const line of view.state.field(paintField).paint.lines) {
        const first = doc.lineAt(Math.min(line.from, doc.length)).number;
        const last = doc.lineAt(Math.min(Math.max(line.from, line.to - 1), doc.length)).number;
        for (let at = first; at <= last; at += 1) {
          const from = view.lineBlockAt(doc.line(at).from).from;
          if (!starts.has(from)) starts.set(from, line.class);
        }
      }
      const builder = new RangeSetBuilder<Decoration>();
      for (const from of [...starts.keys()].sort((a, b) => a - b))
        builder.add(from, from, Decoration.line({ class: starts.get(from) ?? "" }));
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const decorate = (state: EditorState, paint: DiffPaint): DecorationSet => {
  const doc = state.doc;
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  for (const mark of paint.marks)
    if (mark.to > mark.from)
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
    return tr.docChanged ? { ...held, set: held.set.map(tr.changes) } : held;
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
        const from = view.lineBlockAt(Math.min(control.at, doc.length)).from;
        if (seen.has(from)) continue;
        seen.add(from);
        builder.add(from, from, new Control(control.key, control.render));
      }
      return builder.finish();
    },
  });

export function mountDiffView(options: DiffViewOptions): DiffViewMount {
  const done = span("diff-mount", `${(options.text.length / 1024) | 0}KB`);
  const projection = new Compartment();

  const state = EditorState.create({
    doc: options.text,
    extensions: [
      analyzer.of(options.analyze),
      readingLayer,
      viewLayer(),
      projection.of(modeView(options.mode, "cm-diff")),
      // Seeded with the first paint, so the gutter's first pass has markers.
      paintField.init((state) => ({ paint: options.paint, set: decorate(state, options.paint) })),
      tints,
      controlGutter(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  });
  const view = new EditorView({ state, parent: options.parent });
  done();

  return {
    view,
    repaint: (paint) => view.dispatch({ effects: setPaint.of(paint) }),
    setMode: (mode) =>
      view.dispatch({ effects: projection.reconfigure(modeView(mode, "cm-diff")) }),
    showAt: (at) => {
      view.dispatch({
        effects: EditorView.scrollIntoView(Math.min(at, view.state.doc.length), { y: "start" }),
      });
    },
    destroy: () => view.destroy(),
  };
}
