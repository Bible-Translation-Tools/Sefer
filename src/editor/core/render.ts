/**
 * The render window: decorate the visible ranges plus a margin, not the book.
 *
 * A 60,000-line book cannot be decorated per keystroke, and it does not need to
 * be. The plugin widens the viewport by `RENDER_MARGIN` and keeps the range
 * stable until the view leaves it (hysteresis), so scrolling costs one rebuild
 * per screenful rather than one per frame.
 */

import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export interface RenderRange {
  from: number;
  to: number;
}

export const RENDER_MARGIN = 2000;

export function widen(len: number, from: number, to: number, margin = RENDER_MARGIN): RenderRange {
  return { from: Math.max(0, from - margin), to: Math.min(len, to + margin) };
}

export const setRenderRange = StateEffect.define<RenderRange | null>();

export const renderRangeField = StateField.define<RenderRange | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setRenderRange)) return e.value;
    if (v === null || !tr.docChanged) return v;
    return { from: tr.changes.mapPos(v.from, -1), to: tr.changes.mapPos(v.to, 1) };
  },
});

export function renderRangeAt(state: EditorState): RenderRange | null {
  return state.field(renderRangeField, false) ?? null;
}

function onScreen(view: EditorView): RenderRange {
  const len = view.state.doc.length;
  const ranges = view.visibleRanges;
  if (!ranges.length) return { from: 0, to: len };
  const doc = view.state.doc;
  const clamp = (p: number) => Math.max(0, Math.min(p, len));
  return {
    from: doc.lineAt(clamp(ranges[0].from)).from,
    to: doc.lineAt(clamp(ranges[ranges.length - 1].to)).to,
  };
}

const covers = (have: RenderRange | null, want: RenderRange) =>
  have !== null && have.from <= want.from && have.to >= want.to;

class RenderWindow {
  private view: EditorView;
  private queued = false;
  private gone = false;

  constructor(view: EditorView) {
    this.view = view;
    this.sync();
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.geometryChanged) this.sync();
  }

  destroy() {
    this.gone = true;
  }

  private sync() {
    if (this.queued || this.gone) return;
    const held = this.view.state.field(renderRangeField, false);
    if (held === undefined) return;
    const need = onScreen(this.view);
    if (covers(held, need)) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.gone) return;
      const now = onScreen(this.view);
      if (covers(this.view.state.field(renderRangeField, false) ?? null, now)) return;
      this.view.dispatch({
        effects: setRenderRange.of(widen(this.view.state.doc.length, now.from, now.to)),
      });
    });
  }
}

export const renderWindow: Extension = ViewPlugin.fromClass(RenderWindow);
