import {
  Annotation,
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export interface RenderRange {
  from: number;
  to: number;
}

const RENDER_MARGIN = 2000;

const SETTLE_LIMIT = 4;

function widen(len: number, from: number, to: number, margin = RENDER_MARGIN): RenderRange {
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

const union = (a: RenderRange, b: RenderRange): RenderRange => ({
  from: Math.min(a.from, b.from),
  to: Math.max(a.to, b.to),
});

const windowMove = Annotation.define<true>();

class RenderWindow {
  private view: EditorView;
  private queued = false;
  private gone = false;
  private settling = 0;

  constructor(view: EditorView) {
    this.view = view;
    this.sync(false);
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.geometryChanged)
      this.sync(u.transactions.some((tr) => tr.annotation(windowMove) === true));
  }

  destroy() {
    this.gone = true;
  }

  private sync(settling: boolean) {
    if (this.queued || this.gone) return;
    const held = this.view.state.field(renderRangeField, false);
    if (held === undefined) return;
    const need = onScreen(this.view);
    if (covers(held, need)) {
      this.settling = 0;
      return;
    }
    this.settling = settling ? this.settling + 1 : 0;
    this.queued = true;
    if (this.settling > SETTLE_LIMIT) {
      this.settling = 0;
      requestAnimationFrame(() => {
        this.queued = false;
        this.sync(false);
      });
      return;
    }
    requestAnimationFrame(() => {
      this.queued = false;
      if (this.gone) return;
      const now = onScreen(this.view);
      const was = this.view.state.field(renderRangeField, false) ?? null;
      if (covers(was, now)) return;
      const next = widen(this.view.state.doc.length, now.from, now.to);
      this.view.dispatch({
        effects: setRenderRange.of(settling && was !== null ? union(was, next) : next),
        annotations: windowMove.of(true),
      });
    });
  }
}

export const renderWindow: Extension = ViewPlugin.fromClass(RenderWindow);
