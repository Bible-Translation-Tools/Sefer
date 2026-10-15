/**
 * A flash: the place a jump landed, marked for a moment.
 *
 * `scrollIntoView` moves the page and says nothing about WHY. When a reader
 * clicks a search hit and the book is already the one on screen, the scroll
 * may be a few pixels or none at all, and the honest signal that the click
 * did something is the target itself lighting up.
 *
 * A state field rather than a class on a DOM node: CodeMirror owns the line
 * elements and rewrites them on every update, so a hand-added class survives
 * until the next update and no longer. The decoration maps through edits like
 * any other, and clears itself.
 *
 * A MARK over the range, not a line decoration, when the caller knows both
 * ends: the reading projection joins and hides whole lines, and a line
 * decoration on a line the projection replaced is a decoration that never
 * appears. An inline mark survives that, and it is also the more precise
 * answer — it marks the words, not the paragraph they are in.
 */

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface FlashRange {
  readonly from: number;
  readonly to: number;
}

const setFlash = StateEffect.define<FlashRange | null>();

const SPAN = Decoration.mark({ class: "usfm-flash" });
const LINE = Decoration.line({ class: "usfm-focus" });

const decorationsFor = (
  doc: { length: number; lineAt: (at: number) => { from: number } },
  range: FlashRange,
): DecorationSet => {
  const from = Math.max(0, Math.min(range.from, doc.length));
  const to = Math.max(from, Math.min(range.to, doc.length));
  return to > from
    ? Decoration.set([SPAN.range(from, to)], true)
    : Decoration.set([LINE.range(doc.lineAt(from).from)], true);
};

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(held, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setFlash)) continue;
      return effect.value === null ? Decoration.none : decorationsFor(tr.state.doc, effect.value);
    }
    return tr.docChanged ? held.map(tr.changes) : held;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The extension. Added once, per view. */
export const flashing = (): Extension => flashField;

/**
 * Marks `range` for `ms`, then clears it. Returns the canceller, so a second
 * flash before the first has faded does not leave a timer that clears it.
 */
export const flash = (view: EditorView, range: FlashRange, ms = 1200): (() => void) => {
  view.dispatch({ effects: setFlash.of(range) });
  const timer = setTimeout(() => {
    view.dispatch({ effects: setFlash.of(null) });
  }, ms);
  return () => {
    clearTimeout(timer);
  };
};
