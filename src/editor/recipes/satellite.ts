/**
 * Satellites (seams §3.9): a second surface over ONE range of a book — a note
 * apparatus, a source mirror, a card that is editable in place.
 *
 * A satellite is a reader that may write, and the whole of its discipline is
 * in `dispatch` below: it never keeps its own text. A local edit is turned
 * into changes, submitted through the `Funnel`, and the satellite waits for
 * the canonical Book to hand it back. Its caret is its own across that round
 * trip; its text is not.
 */

import { defaultKeymap } from "@codemirror/commands";
import { EditorState, Facet, type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";

import type { Trust } from "#core/book/book";

import { viewLayer } from "../core/compose";
import { borrowedStructure } from "../core/docStructure";
import { trusted } from "../core/kernel";
import { span } from "../core/timing";
import { changesOf, fromCanonical, type Funnel } from "../funnel";

export interface Satellite {
  view: EditorView;
  range: { from: number; to: number };
  destroy(): void;
}

const windowEffect = StateEffect.define<{ from: number; to: number }>();

const initialRange = Facet.define<{ from: number; to: number }, { from: number; to: number }>({
  combine: (v) => v[0] ?? { from: 0, to: 0 },
});

const scope = StateField.define<{ from: number; to: number }>({
  create: (state) => state.facet(initialRange),
  update(range, tr) {
    for (const e of tr.effects) if (e.is(windowEffect)) return e.value;
    return tr.docChanged
      ? { from: tr.changes.mapPos(range.from, -1), to: tr.changes.mapPos(range.to, 1) }
      : range;
  },
});

export const satelliteRange = (state: EditorState) => state.field(scope, false) ?? null;

/**
 * Re-clips a LIVE satellite to a new range.
 *
 * The alternative is destroying the view and mounting another, which loses
 * the caret, the selection and the scroll — and a reader who asked to see one
 * more verse did not ask to lose their place. The window is a state field, so
 * moving it is one transaction.
 */
export const reclip = (view: EditorView, range: { from: number; to: number }): void => {
  view.dispatch({ effects: windowEffect.of(range) });
};

function collapseOutside(state: EditorState, range: { from: number; to: number }): DecorationSet {
  const len = state.doc.length;
  const out = [];
  const from = Math.max(0, Math.min(range.from, len));
  const to = Math.max(from, Math.min(range.to, len));
  if (from > 0) out.push(Decoration.replace({ block: true }).range(0, Math.max(0, from - 1)));
  if (to < len) out.push(Decoration.replace({ block: true }).range(Math.min(len, to), len));
  return Decoration.set(out, true);
}

/**
 * The satellite's own clip, as an extension: everything outside `range` is
 * replaced by a block widget, so the view shows one excerpt of a whole book.
 *
 * Recomputed from the `scope` field rather than from the range the caller
 * passed, so the clip follows the text: an edit above the excerpt moves it,
 * and an edit inside it grows it, without the caller re-mounting anything.
 */
export const clippedToScope = (): Extension =>
  EditorView.decorations.compute([scope], (state) => collapseOutside(state, state.field(scope)));

/** A range a satellite was asked to highlight. */
export type MarkedRange = { readonly from: number; readonly to: number };

const HIT_MARK = Decoration.mark({ class: "cm-excerpt-hit" });

const decorationsOf = (ranges: readonly MarkedRange[]): DecorationSet =>
  Decoration.set(
    ranges
      .filter((range) => range.to > range.from)
      .map((range) => HIT_MARK.range(range.from, range.to)),
    true,
  );

const initialMarks = Facet.define<readonly MarkedRange[], readonly MarkedRange[]>({
  combine: (values) => values[0] ?? [],
});

const setMarks = StateEffect.define<readonly MarkedRange[]>();

const markField = StateField.define<DecorationSet>({
  create: (state) => decorationsOf(state.facet(initialMarks)),
  update(marks, tr) {
    for (const effect of tr.effects) if (effect.is(setMarks)) return decorationsOf(effect.value);
    return tr.docChanged ? marks.map(tr.changes) : marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Paints `ranges` — the matches this excerpt was opened for — inside a
 * satellite, and maps them through every edit like any other decoration. The
 * class is `src/editor/editor.css`'s, so the highlight is the one the
 * read-only card shows and the reader does not lose the match by clicking
 * Edit.
 */
export const markedRanges = (ranges: readonly MarkedRange[]): Extension => [
  initialMarks.of(ranges),
  markField,
];

export interface SatelliteOptions {
  /** Where the view mounts. */
  readonly parent: HTMLElement;
  /** The canonical Book, as a Funnel. Every edit goes through it. */
  readonly host: Funnel;
  readonly trust?: Trust;
  readonly range: { from: number; to: number };
  readonly extensions: Extension[];
  readonly editable: boolean;
  /** Names the surface in the origin of its edits and in the trace. */
  readonly label: string;
}

/**
 * Mounts one satellite view over `opts.range` of the host book.
 *
 * Note what is NOT installed here: the reading layer. A satellite gets
 * `viewLayer()`, the undo keys (which delegate to the host — a satellite has
 * no history of its own, because the book's history is the book's) and the
 * default keymap. A caller that wants USFM decorations inside the satellite
 * passes them in `extensions`, together with the `analyzer` facet the reading
 * layer needs; `borrowedStructure` is offered so that when it does, the
 * canonical parse is reused rather than repeated.
 */
export function mountSatellite(opts: SatelliteOptions): Satellite {
  const done = span("satellite-mount", opts.label);
  let detach: () => void = () => {};

  const state = EditorState.create({
    doc: opts.host.doc(),
    extensions: [
      initialRange.of(opts.range),
      scope,
      borrowedStructure.of(() => opts.host.structure()),
      EditorView.editable.of(opts.editable),
      viewLayer(),
      keymap.of([
        { key: "Mod-z", run: () => opts.host.undo() },
        { key: "Mod-Shift-z", run: () => opts.host.redo() },
        { key: "Mod-y", run: () => opts.host.redo() },
      ]),
      keymap.of(defaultKeymap),
      ...opts.extensions,
    ],
  });

  const view = new EditorView({
    state,
    parent: opts.parent,
    dispatch(tr, self) {
      if (!tr.docChanged || tr.annotation(fromCanonical)) {
        self.update([tr]);
        return;
      }
      const done2 = span("satellite-reconcile", opts.label);
      opts.host.submit(changesOf(tr.changes), opts.label, opts.trust);
      if (tr.selection)
        self.dispatch({ selection: tr.selection, annotations: fromCanonical.of(true) });
      done2();
    },
  });

  const sat: Satellite = {
    view,
    get range() {
      return view.state.field(scope);
    },
    destroy() {
      detach();
      view.destroy();
    },
  };
  detach = opts.host.attach((changes) => {
    view.dispatch({
      changes,
      annotations: [fromCanonical.of(true), trusted.of("canonical")],
      filter: false,
    });
  });
  done();
  return sat;
}
