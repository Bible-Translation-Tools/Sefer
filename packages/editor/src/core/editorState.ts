import {
  EditorState,
  type Extension,
  Facet,
  Prec,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

import { canonicalCaret } from "./caret";
import { editableClipAt, pickField, visibleClipAt, type ClipRange } from "./guards/clip";
import { type PaintPort, modeFacet } from "./kernel";
import { docText, structureAt, structureField } from "./model/docStructure";
import {
  type BuildOpts,
  DEFAULT_BUILD_OPTS,
  buildRegular,
  buildUsfm,
  isIsolate,
  isUnit,
} from "./paint/decorations";
import { paintOver, type PaintIndex } from "./paint/paint";
import { renderRangeAt, renderRangeField } from "./paint/render";

export { editableClipAt, pickField, structureAt, structureField, type ClipRange };

import { span } from "./instrument/timing";
import { stateFailed } from "./instrument/trace";
import { PROJECTIONS, assignment, assignmentAt } from "./model/registry";
import { type DocPlan, resolvePlan } from "./paint/plan";

export const optsFacet = Facet.define<BuildOpts, BuildOpts>({
  combine: (v) => v[0] ?? DEFAULT_BUILD_OPTS,
});

function buildOptsAt(state: EditorState): BuildOpts {
  const base = state.facet(optsFacet);
  return {
    ...base,
    window: base.window ?? visibleClipAt(state),
    range: base.range ?? renderRangeAt(state),
  };
}

export const usfmModeProjection: Extension = Prec.lowest(
  assignment.compute([modeFacet], (st) => (st.facet(modeFacet) === "usfm" ? PROJECTIONS.usfm : {})),
);

const planCache = new WeakMap<EditorState, DocPlan>();

export function planAt(state: EditorState): DocPlan {
  const structure = state.field(structureField);
  let p = planCache.get(state);
  if (!p) {
    p = resolvePlan(structure, assignmentAt(state));
    planCache.set(state, p);
  }
  if (p.revision !== structure.revision)
    throw new Error(`stale plan: revision ${p.revision} over a fold at ${structure.revision}`);
  return p;
}

export function caretClipAt(st: EditorState): ClipRange {
  const windowRange = editableClipAt(st);
  if (!windowRange) return null;
  const from = canonicalCaret(st, structureAt(st), windowRange.from, PAINT_PORT);
  return { from: Math.max(windowRange.from, Math.min(from, windowRange.to)), to: windowRange.to };
}

interface Built {
  set: DecorationSet;
  atomic: DecorationSet;
  isolates: DecorationSet;
  stats: { decorations: number; joined: number; blocks: number; ms: number };
}

function buildInner(state: EditorState): Built {
  const startedAt = performance.now();
  const done = span("decorate", () => (state.facet(modeFacet) === "regular" ? "visual" : "usfm"));
  const structure = state.field(structureField);
  const doc = docText(state);
  const opts = buildOptsAt(state);
  const r =
    state.facet(modeFacet) === "regular"
      ? buildRegular(doc, structure, planAt(state), opts)
      : buildUsfm(doc, structure, opts);
  const units: { from: number; to: number; deco: Decoration }[] = [];
  const isos: { from: number; to: number; deco: Decoration }[] = [];
  const b = new RangeSetBuilder<Decoration>();
  const iso = new RangeSetBuilder<Decoration>();
  r.set.between(0, doc.length, (from, to, deco) => {
    if (to > from && isUnit(deco)) units.push({ from, to, deco });
    if (to > from && isIsolate(deco)) isos.push({ from, to, deco });
  });
  const order = (
    x: { from: number; to: number; deco: Decoration },
    y: { from: number; to: number; deco: Decoration },
  ) => x.from - y.from || x.deco.startSide - y.deco.startSide || x.to - y.to;
  for (const u of units.sort(order)) b.add(u.from, u.to, u.deco);
  for (const i of isos.sort(order)) iso.add(i.from, i.to, i.deco);
  done();
  return {
    set: r.set,
    atomic: b.finish(),
    isolates: iso.finish(),
    stats: { ...r.stats, ms: +(performance.now() - startedAt).toFixed(2) },
  };
}

function build(state: EditorState): Built {
  try {
    return buildInner(state);
  } catch (err) {
    stateFailed("decorate", err);
    return {
      set: Decoration.none,
      atomic: Decoration.none,
      isolates: Decoration.none,
      stats: { decorations: 0, joined: 0, blocks: 0, ms: -1 },
    };
  }
}

export const decoField = StateField.define<Built>({
  create: build,
  update(v, tr) {
    const changed =
      tr.docChanged ||
      tr.startState.facet(modeFacet) !== tr.state.facet(modeFacet) ||
      tr.startState.facet(optsFacet) !== tr.state.facet(optsFacet) ||
      tr.startState.field(pickField, false) !== tr.state.field(pickField, false) ||
      tr.startState.field(renderRangeField, false) !== tr.state.field(renderRangeField, false) ||
      tr.startState.facet(assignment) !== tr.state.facet(assignment);
    return changed ? build(tr.state) : v;
  },
  provide: (f) => EditorView.decorations.from(f, (b) => b.set),
});

const renderingCache = new WeakMap<EditorState, PaintIndex>();

function paintAt(state: EditorState): PaintIndex {
  let r = renderingCache.get(state);
  if (!r) {
    const done = span("paint");
    r = paintOver(state.field(structureField), planAt(state));
    done();
    renderingCache.set(state, r);
  }
  return r;
}

function drawsAt(state: EditorState, pos: number): boolean {
  if (state.facet(modeFacet) !== "regular") return false;
  return paintAt(state).draws(pos);
}

const NO_ATOMS: readonly { from: number; to: number }[] = [];

export const PAINT_PORT: PaintPort = {
  hidden: (state, from, to) =>
    state.facet(modeFacet) === "regular" && paintAt(state).hidden(from, to),
  draws: drawsAt,
  joined: (state, pos) => state.facet(modeFacet) === "regular" && paintAt(state).joined(pos),
  atomic: (state, l) => (state.facet(modeFacet) === "regular" ? planAt(state).atomic(l) : NO_ATOMS),
};
