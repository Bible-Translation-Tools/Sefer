import { defaultKeymap } from "@codemirror/commands";
import {
  EditorState,
  Facet,
  Prec,
  type Extension,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";
import { Refusal } from "@sefer/text/book";

import { settleTheCaretOnALegalPosition } from "../core/caret";
import { pullSelectionsIntoTheClip } from "../core/clip";
import { deletionKeys, motionKeys, viewLayer } from "../core/compose";
import { DEFAULT_BUILD_OPTS } from "../core/decorations";
import { borrowedStructure, structureAt, structureField } from "../core/docStructure";
import { optsFacet, PAINT_PORT } from "../core/editorState";
import { touchedBy } from "../core/forward";
import { localTracer, tracer } from "../core/instrument";
import { isVisual, modeFacet, trusted } from "../core/kernel";
import { assignment } from "../core/registry";
import { stopsIn } from "../core/stops";
import { span } from "../core/timing";
import { changesOf, fromCanonical, ownEcho, type Funnel, type SurfaceTerms } from "../funnel";

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

const caretKeptInScope: Extension = EditorState.transactionFilter.of(
  pullSelectionsIntoTheClip(satelliteRange, { trustWaives: false }),
);

const structured = (state: EditorState): boolean =>
  state.field(structureField, false) !== undefined;

const settleAsTheBookDoes = settleTheCaretOnALegalPosition(structureAt, PAINT_PORT);

const caretSettled: Extension = EditorState.transactionFilter.of((tr) =>
  tr.docChanged || !structured(tr.state) ? tr : settleAsTheBookDoes(tr),
);

const rangeEdgesSettled: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || !structured(tr.state) || !isVisual(tr.state)) return tr;
  const sel = tr.state.selection.main;
  const windowRange = satelliteRange(tr.state);
  if (windowRange === null) return tr;
  let edge = windowRange.to;
  if (windowRange.to < tr.state.doc.length)
    while (edge > windowRange.from && tr.state.doc.sliceString(edge - 1, edge) === "\n") edge--;
  const lo = Math.min(sel.anchor, sel.head);
  const hi = Math.max(sel.anchor, sel.head);
  if (lo > windowRange.from && hi < edge) return tr;
  const stops = stopsIn(tr.state, structureAt(tr.state), PAINT_PORT);
  const inward = (pos: number, toward: "forward" | "backward", limit: number): number => {
    if (stops.isStop(pos)) return pos;
    const settled = stops.settle(pos, toward);
    const inside =
      toward === "forward"
        ? settled >= pos && settled <= limit
        : settled <= pos && settled >= limit;
    return inside ? settled : pos;
  };
  if (sel.empty) {
    let at = lo;
    if (lo <= windowRange.from) at = inward(lo, "forward", edge);
    else if (hi >= edge) at = inward(hi, "backward", windowRange.from);
    return at === lo ? tr : [tr, { selection: { anchor: at }, sequential: true }];
  }
  const from = lo <= windowRange.from ? inward(lo, "forward", hi) : lo;
  const to = hi >= edge ? inward(hi, "backward", from) : hi;
  if (from === lo && to === hi) return tr;
  const forward = sel.head >= sel.anchor;
  return [
    tr,
    {
      selection: forward ? { anchor: from, head: to } : { anchor: to, head: from },
      sequential: true,
    },
  ];
});

const termsOf = (tr: Transaction): SurfaceTerms => {
  const event = tr.annotation(Transaction.userEvent);
  return {
    projection: tr.startState.facet(assignment).deltas,
    mode: tr.startState.facet(modeFacet),
    range: tr.startState.field(scope),
    ...(event === undefined ? {} : { event }),
  };
};

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
  const doc = state.doc;
  const len = doc.length;
  const out = [];
  const from = Math.max(0, Math.min(range.from, len));
  const to = Math.max(from, Math.min(range.to, len));
  const first = doc.lineAt(from);
  const last = doc.lineAt(to);
  if (first.from > 0) out.push(Decoration.replace({ block: true }).range(0, first.from - 1));
  if (from > first.from) out.push(Decoration.replace({}).range(first.from, from));
  if (to < last.to)
    out.push(Decoration.replace({ inclusiveStart: false }).range(Math.max(to, from), last.to));
  if (last.to < len)
    out.push(Decoration.replace({ block: true, inclusiveStart: false }).range(last.to, len));
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
export const clippedToScope = (): Extension => [
  EditorView.decorations.compute([scope], (state) => collapseOutside(state, state.field(scope))),
  optsFacet.compute([scope], (state) => ({ ...DEFAULT_BUILD_OPTS, clip: state.field(scope) })),
];

/**
 * The clip on its own, for a view that is not a satellite: the range, the
 * field that holds it and the collapse outside it — the same three a
 * satellite's clip is made of, so `reclip` and `satelliteRange` answer for
 * both and an excerpt reads and edits through one definition of "the part of
 * the book this card is".
 */
export const clipped = (range: { from: number; to: number }): Extension => [
  initialRange.of(range),
  scope,
  clippedToScope(),
];

/**
 * A span of the book, snapped to whole lines and clamped to the document:
 * what a render window takes (`setRenderRange`), which draws whole lines.
 * A card's clip no longer snaps — `clipSpan` — because `collapseOutside`
 * hides the rest of a partly shown line inline. A unit's end is the next unit's anchor,
 * which sits at the START of its own line, so the last line is the one before
 * it.
 */
export const wholeLines = (
  doc: { length: number; lineAt: (at: number) => { from: number; to: number } },
  span: { readonly from: number; readonly to: number },
): { from: number; to: number } => {
  const start = Math.max(0, Math.min(span.from, doc.length));
  const end = Math.max(start, Math.min(span.to, doc.length));
  return { from: doc.lineAt(start).from, to: doc.lineAt(Math.max(start, end - 1)).to };
};

/**
 * `wholeLines` over a string, before there is a document to ask: the start of
 * the line `from` is on, to the end of the line before `to`.
 */
export const wholeLinesOf = (
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

/**
 * A span of the book as a card shows it: clamped to the document, and
 * without the whitespace it ends on, but NOT snapped to whole lines —
 * `collapseOutside` hides the rest of a partly shown line inline. A unit's
 * end is the next unit's anchor (`\v 3`), and the space or line break before
 * it separates the two: left outside, so the next verse's number is hidden
 * with the rest. Text typed at the end still shows: the range's end maps
 * forward over an insertion there.
 */
export const clipSpanOf = (
  text: string,
  span: { readonly from: number; readonly to: number },
): { from: number; to: number } => {
  const from = Math.max(0, Math.min(span.from, text.length));
  let to = Math.max(from, Math.min(span.to, text.length));
  while (to > from && /\s/.test(text[to - 1] ?? "")) to -= 1;
  return { from, to };
};

/** `clipSpanOf` over a document. */
export const clipSpan = (
  doc: { length: number; sliceString: (from: number, to: number) => string },
  span: { readonly from: number; readonly to: number },
): { from: number; to: number } => {
  const from = Math.max(0, Math.min(span.from, doc.length));
  let to = Math.max(from, Math.min(span.to, doc.length));
  while (to > from && /\s/.test(doc.sliceString(to - 1, to))) to -= 1;
  return { from, to };
};

/**
 * A range a view was asked to highlight. `class` says what the mark means —
 * the current match, a finding's severity, the context around the own unit —
 * and defaults to the plain hit.
 */
export type MarkedRange = {
  readonly from: number;
  readonly to: number;
  readonly class?: string;
};

const HIT_CLASS = "cm-excerpt-hit";
const markings = new Map<string, Decoration>();
const markFor = (name: string): Decoration => {
  const held = markings.get(name);
  if (held !== undefined) return held;
  const made = Decoration.mark({ class: name });
  markings.set(name, made);
  return made;
};

const decorationsOf = (ranges: readonly MarkedRange[]): DecorationSet =>
  Decoration.set(
    ranges
      .filter((range) => range.to > range.from)
      .map((range) => markFor(range.class ?? HIT_CLASS).range(range.from, range.to)),
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
    if (!tr.docChanged) return marks;
    const touched = touchedBy(tr.changes);
    return marks.map(tr.changes).update({
      filter: (from, to, value) => value.spec.class === CONTEXT_CLASS || !touched(from, to),
    });
  },
  provide: (field) => EditorView.decorations.from(field),
});

const CONTEXT_CLASS = "cm-excerpt-context";

/**
 * Paints `ranges` — the matches this excerpt was opened for — inside a
 * satellite, and maps them through every edit like any other decoration. The
 * class is `packages/editor/src/editor.css`'s, so the highlight is the one the
 * read-only card shows and the reader does not lose the match by clicking
 * Edit.
 */
export const markedRanges = (ranges: readonly MarkedRange[]): Extension => [
  initialMarks.of(ranges),
  markField,
];

/**
 * The two moves as EFFECTS, for a caller that wants them in one transaction
 * with others — the stamp press sets a card's clip, its render range and its
 * marks in one dispatch, and reads the DOM once.
 */
export const clipEffect = (range: { from: number; to: number }) => windowEffect.of(range);
export const marksEffect = (ranges: readonly MarkedRange[]) => setMarks.of(ranges);

/** Replaces what `markedRanges` paints — the match cursor moved, a tone changed. */
export const remark = (view: EditorView, ranges: readonly MarkedRange[]): void => {
  view.dispatch({ effects: setMarks.of(ranges) });
};

export interface SatelliteOptions {
  /** Where the view mounts. */
  readonly parent: HTMLElement;
  /** The canonical Book, as a Funnel. Every edit goes through it. */
  readonly host: Funnel;
  readonly range: { from: number; to: number };
  readonly extensions: Extension[];
  readonly editable: boolean;
  /** Names the surface in the origin of its edits and in the trace. */
  readonly label: string;
}

function satelliteExtensions(opts: SatelliteOptions): Extension[] {
  return [
    initialRange.of(opts.range),
    scope,
    rangeEdgesSettled,
    caretKeptInScope,
    caretSettled,
    borrowedStructure.of(() => opts.host.structure()),
    EditorView.editable.of(opts.editable),
    viewLayer(),
    Prec.high(
      keymap.of(
        [...motionKeys(), ...deletionKeys()].map((binding) => ({
          ...binding,
          run: (target: EditorView) =>
            structured(target.state) && binding.run !== undefined && binding.run(target),
        })),
      ),
    ),
    keymap.of([
      { key: "Mod-z", run: () => opts.host.undo() },
      { key: "Mod-Shift-z", run: () => opts.host.redo() },
      { key: "Mod-y", run: () => opts.host.redo() },
    ]),
    EditorView.domEventHandlers({
      beforeinput(event) {
        const undo = event.inputType === "historyUndo";
        if (!undo && event.inputType !== "historyRedo") return false;
        event.preventDefault();
        if (undo) opts.host.undo();
        else opts.host.redo();
        return true;
      },
    }),
    keymap.of(defaultKeymap),
    Prec.lowest(tracer.of(opts.host.tracer?.() ?? localTracer)),
    ...opts.extensions,
  ];
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
    extensions: satelliteExtensions(opts),
  });

  let submitting = false;
  const view = new EditorView({
    state,
    parent: opts.parent,
    dispatch(tr, self) {
      if (!tr.docChanged || tr.annotation(fromCanonical)) {
        self.update([tr]);
        return;
      }
      const done2 = span("satellite-reconcile", opts.label);
      submitting = true;
      let outcome: ReturnType<typeof opts.host.submit>;
      try {
        outcome = opts.host.submit(changesOf(tr.changes), opts.label, termsOf(tr));
      } finally {
        submitting = false;
      }
      if (tr.selection && !(outcome instanceof Refusal))
        self.dispatch({ selection: tr.selection, annotations: fromCanonical.of(true) });
      done2();
    },
  });

  const satellite: Satellite = {
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
      annotations: [fromCanonical.of(true), ownEcho.of(submitting), trusted.of("canonical")],
      filter: false,
    });
  });
  done();
  return satellite;
}
