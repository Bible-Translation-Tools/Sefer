/**
 * Satellites: a second surface over ONE range of a book — a note
 * apparatus, a source mirror, a card that is editable in place.
 *
 * A satellite is a reader that may write, and the whole of its discipline is
 * in `dispatch` below: it never keeps its own text. A local edit is turned
 * into changes, submitted through the `Funnel`, and the satellite waits for
 * the canonical Book to hand it back. Its caret is its own across that round
 * trip; its text is not.
 */

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

import { Refusal } from "#core/book/book";

import { settleTheCaretOnALegalPosition } from "../core/caret";
import { pullSelectionsIntoTheClip } from "../core/clip";
import { motionKeys, viewLayer } from "../core/compose";
import { borrowedStructure, structureAt, structureField } from "../core/docStructure";
import { PAINT_PORT } from "../core/editorState";
import { isVisual, modeFacet, trusted } from "../core/kernel";
import { assignment } from "../core/registry";
import { stopsIn } from "../core/stops";
import { span } from "../core/timing";
import { changesOf, fromCanonical, type Funnel, type SurfaceTerms } from "../funnel";

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
 * The range is an EDIT GUARD, not only a clip — and both halves are installed
 * by `mountSatellite`, so no surface can mount without them.
 *
 * `clippedToScope` only hides what is outside the range, and a satellite's
 * document is the whole book: select all, Backspace, and the reader deleted
 * every verse they could not see (Philemon went from 2,679 characters to the
 * 158 the Book's own marker rules protect).
 *
 * The CHANGE half is the Book's: every submit carries the range in its terms
 * (`termsOf`), and the Book's admission refuses whatever part of the change
 * lies outside it (`refuseEditsOutsideTheSurface`, `core/phases.ts`) — which
 * is where every way an edit can arrive passes: a key, a command that edits
 * away from the caret, drag and drop, a paste, a programmatic dispatch. The
 * SELECTION half is the surface's own, because the caret is: it is pulled
 * into the range here, so it never sits where typing would be refused, and
 * select-all selects the range. Both are `core/clip.ts`'s rules, the chapter
 * clip's own pair, over this range; trust waives neither.
 *
 * The canonical text coming home is dispatched with `filter: false`, so the
 * selection rule never sees it.
 */
const caretKeptInScope: Extension = EditorState.transactionFilter.of(
  pullSelectionsIntoTheClip(satelliteRange, { trustWaives: false }),
);

/** A satellite that installed the structure (every editable one does) can be settled. */
const structured = (state: EditorState): boolean =>
  state.field(structureField, false) !== undefined;

const settleAsTheBookDoes = settleTheCaretOnALegalPosition(structureAt, PAINT_PORT);

/**
 * THE BOOK'S SETTLEMENT, over the satellite's own state: the same rule, the
 * same stops, read under the surface's projection and mode — and then the
 * range pulls the caret in, so the rule is the book's and the range is
 * smaller. Before it a satellite had no settlement at all, and its caret
 * rested where the main editor's never could: before a hidden `\v` at a line
 * start, one past a paragraph's end.
 *
 * A local edit is skipped: it is never applied here (it goes to the Book and
 * comes home), and its caret is settled when it does.
 */
const caretSettled: Extension = EditorState.transactionFilter.of((tr) =>
  tr.docChanged || !structured(tr.state) ? tr : settleAsTheBookDoes(tr),
);

/**
 * A selection the range cut — select-all, a drag past the edge — ends where
 * the range does, which may be inside hidden markup (the `\v 5 ` a verse line
 * opens with). Each end the range put there is moved onto the nearest stop
 * inside the selection, as the caret would be: the edge of the range is the
 * edge of the document for this surface, and the book's own select-all starts
 * and ends on what a reader can see as well.
 */
const rangeEdgesSettled: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || !structured(tr.state) || !isVisual(tr.state)) return tr;
  const sel = tr.state.selection.main;
  const win = satelliteRange(tr.state);
  if (win === null) return tr;
  // Where the range rule pulls a selection's far end: the range's end, less
  // the line break a whole-line range closes on.
  let edge = win.to;
  if (win.to < tr.state.doc.length)
    while (edge > win.from && tr.state.doc.sliceString(edge - 1, edge) === "\n") edge--;
  const lo = Math.min(sel.anchor, sel.head);
  const hi = Math.max(sel.anchor, sel.head);
  if (lo > win.from && hi < edge) return tr;
  const stops = stopsIn(tr.state, structureAt(tr.state), PAINT_PORT);
  // Inward only, and never past the other end: a caret the book's settlement
  // sent to a stop OUTSIDE the range (Home on an excerpt's first row settles
  // back to the paragraph before it) and the range then pulled to its edge is
  // settled again, toward the inside.
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
    if (lo <= win.from) at = inward(lo, "forward", edge);
    else if (hi >= edge) at = inward(hi, "backward", win.from);
    return at === lo ? tr : [tr, { selection: { anchor: at }, sequential: true }];
  }
  const from = lo <= win.from ? inward(lo, "forward", hi) : lo;
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

/**
 * What this surface shows, for the Book to judge its edit under: its own
 * projection and mode (whatever `modeView` the caller installed; the default
 * projection in regular mode when it installed none) and its live range.
 */
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
 * A span of the book, snapped to whole lines and clamped to the document.
 *
 * `collapseOutside` replaces what is outside the range with block widgets,
 * and a block replacement that does not start and end at a line boundary is
 * not something CodeMirror will draw. A unit's end is the next unit's anchor,
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
      // Transaction filters run LAST-registered first, so these three run
      // settle → pull into the range → settle what the range cut.
      rangeEdgesSettled,
      caretKeptInScope,
      caretSettled,
      borrowedStructure.of(() => opts.host.structure()),
      EditorView.editable.of(opts.editable),
      viewLayer(),
      // The book's own motion over the stops; a satellite with no structure
      // (none editable today) keeps CodeMirror's.
      Prec.high(
        keymap.of(
          motionKeys().map((binding) => ({
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
      // The browser's own undo, which a key the host declined falls through
      // to (nothing left to undo), and which the Edit menu sends directly. A
      // satellite has no history, so the browser's is of this contenteditable's
      // DOM — and replaying it here made an EDIT out of it: Mod-z past the
      // bottom of the stack, then Mod-Shift-z, left "you have" as "youfhave".
      // CodeMirror's `history()` answers the same event for the canonical view.
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
      const outcome = opts.host.submit(changesOf(tr.changes), opts.label, termsOf(tr));
      // The caret follows an ACCEPTED edit. A refused one left the text as it
      // was, and `tr.selection` is in the coordinates of a text that never
      // came to be — past the end of it, for a refused deletion — so the
      // caret stays where the reader left it.
      if (tr.selection && !(outcome instanceof Refusal))
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
