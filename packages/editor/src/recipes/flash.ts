import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

import { rangeDecorations } from "./rangeDecorations";

export interface FlashRange {
  readonly from: number;
  readonly to: number;
}

const setFlash = StateEffect.define<FlashRange | null>();

const SPAN = Decoration.mark({ class: "usfm-flash" });
const LINE = Decoration.line({ class: "usfm-focus" });

const decorationsFor = (
  doc: Parameters<typeof rangeDecorations>[0],
  range: FlashRange,
): DecorationSet => rangeDecorations(doc, range, SPAN, LINE);

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
