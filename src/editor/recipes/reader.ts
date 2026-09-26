/**
 * The reader: a read-only view of ONE range of a text, painted exactly as the
 * editor paints it.
 *
 * This is what an excerpt card shows until the reader asks to edit it — Zed's
 * multibuffer shape, a small piece of the file. It is the editor's READING half
 * over the book's text (the structure, the projection, the decorations; the
 * same `usfm-p`, verse pips and chapter rules) with the satellite's own clip
 * over it, so a card in Find reads like the page it came from and not like a
 * flattened quotation of it.
 *
 * It is not a satellite: nothing here writes, so there is no Funnel and no seat.
 * An excerpt list must not seat every book it shows — a seat is an editor-
 * backed Book with a journal behind it — and a card that is only being read
 * needs none of that. Edit swaps this view for a satellite over the same range
 * (`ExcerptEditor`), at the same place, in the same projection: to the reader
 * one surface became writable.
 *
 * Read-only is said TWICE, as `reference.ts` says it: `EditorState.readOnly`
 * for commands, `EditorView.editable` so the browser never composes into it.
 *
 * ## One parse, one structure, per book
 *
 * The caller hands over the book's `Analysis`, and the analyzer answers with it
 * — the view's document IS that analysis' text, so no card ever parses. The
 * editor's `DocStructure` built over it is lent to every later view of the same
 * analysis (`borrowedStructure`), so forty cards over one book build it once.
 */

import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { Analysis } from "#core/galley";

import { analyzer } from "../core/analyzer";
import { readingLayer, viewLayer } from "../core/compose";
import { borrowedStructure, structureAt, type DocStructure } from "../core/docStructure";
import { span } from "../core/timing";
import { modeView, type ProjectionName } from "../views";
import { clipped, markedRanges, reclip, remark, wholeLines, type MarkedRange } from "./satellite";

export interface ReaderOptions {
  readonly parent: HTMLElement;
  /** The whole text's parse. The view's document is `analysis.text`. */
  readonly analysis: Analysis;
  /** What to show, in source coordinates. Snapped to whole lines here. */
  readonly range: { readonly from: number; readonly to: number };
  readonly mode: ProjectionName;
  readonly marks: readonly MarkedRange[];
  /** The stylesheet's name for the surface — `cm-excerpt`. */
  readonly surface: string;
  /** Names the view in the timing ring. */
  readonly label: string;
}

export interface ReaderMount {
  readonly view: EditorView;
  setMode(mode: ProjectionName): void;
  /** Shows another range of the same text; the view is kept, not rebuilt. */
  reclip(range: { readonly from: number; readonly to: number }): void;
  remark(marks: readonly MarkedRange[]): void;
  destroy(): void;
}

/**
 * `wholeLines` over a string, before there is a document to ask: the start of
 * the line `from` is on, to the end of the line before `to`.
 */
const linesOf = (
  text: string,
  range: { readonly from: number; readonly to: number },
): { from: number; to: number } => {
  const start = Math.max(0, Math.min(range.from, text.length));
  const end = Math.max(start, Math.min(range.to, text.length));
  const last = Math.max(start, end - 1);
  const close = text.indexOf("\n", last);
  return {
    from: start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1,
    to: close < 0 ? text.length : close,
  };
};

/** The structure first built over each parse, lent to every later reader of it. */
const lent = new WeakMap<Analysis, DocStructure>();

export function mountReader(options: ReaderOptions): ReaderMount {
  const done = span("reader-mount", options.label);
  const projection = new Compartment();
  const { analysis } = options;
  const text = analysis.text;

  const state = EditorState.create({
    doc: text,
    extensions: [
      // The document never changes, so it is always the text this parse
      // describes; anything else asked of it would be a bug upstream.
      analyzer.of(() => analysis),
      borrowedStructure.of(() => lent.get(analysis) ?? null),
      readingLayer,
      viewLayer(),
      projection.of(modeView(options.mode, options.surface)),
      clipped(linesOf(text, options.range)),
      markedRanges(options.marks),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  });
  if (!lent.has(analysis)) lent.set(analysis, structureAt(state));

  const view = new EditorView({ state, parent: options.parent });
  done();

  return {
    view,
    setMode: (mode) => {
      view.dispatch({ effects: projection.reconfigure(modeView(mode, options.surface)) });
    },
    reclip: (range) => {
      reclip(view, wholeLines(view.state.doc, range));
    },
    remark: (marks) => {
      remark(view, marks);
    },
    destroy: () => {
      view.destroy();
    },
  };
}
