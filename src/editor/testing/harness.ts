/**
 * The headless test surface: build a state, press a key, read what is on screen.
 *
 * Not tests — the tools tests are written with. `surface` composes the reading
 * and rules layers with no DOM, `pressKey` runs one binding against a bare
 * state, and `rendered`/`renderedText` say what the decorations would show, so a
 * rule can be asserted in Node without a browser.
 */

import { defaultKeymap } from "@codemirror/commands";
import {
  EditorState,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { Analyze } from "../core/analyzer";
import { type EditorOptions, type RuleName, usfmEditorHeadless, usfmKeys } from "../core/compose";
import type { BuildOpts } from "../core/decorations";
import { DEFAULT_BUILD_OPTS, isInvisible } from "../core/decorations";
import { decoField, optsFacet, pickField } from "../core/editorState";
import { isInsignificantWhitespace } from "../core/exceptions";
import { type Mode, modeFacet, newlineIsABreak } from "../core/kernel";
import { type AssignmentDelta, assignment } from "../core/registry";
import { type TraceSink, traceSink } from "../core/trace";

export const DEFAULT_OPTS = DEFAULT_BUILD_OPTS;

export interface SurfaceOptions {
  /** The engine, per state. See `src/editor/core/analyzer.ts`. */
  analyze: Analyze;
  mode?: Mode;
  opts?: Partial<BuildOpts>;
  delta?: AssignmentDelta;
  omit?: readonly RuleName[];
  anchor?: number | null;
  sink?: TraceSink | null;
  extensions?: readonly Extension[];
  layers?: (o: EditorOptions) => readonly Extension[];
}

export function surface(doc: string, o: SurfaceOptions): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      modeFacet.of(o.mode ?? "regular"),
      assignment.of(o.delta ?? {}),
      optsFacet.of({ ...DEFAULT_OPTS, ...o.opts }),
      newlineIsABreak.of(false),
      ...(o.anchor !== undefined ? [pickField.init(() => o.anchor ?? null)] : []),
      ...(o.sink ? [traceSink.of(o.sink)] : []),
      ...(o.layers ?? usfmEditorHeadless)({ analyze: o.analyze, omit: o.omit ?? [] }),
      ...(o.extensions ?? []),
    ],
  });
}

export const isStop = (state: EditorState, pos: number): boolean =>
  state.update({ selection: { anchor: pos } }).state.selection.main.head === pos;

export function stops(state: EditorState): number[] {
  const out: number[] = [];
  for (let p = 0; p <= state.doc.length; p++) if (isStop(state, p)) out.push(p);
  return out;
}

export const at = (state: EditorState, pos: number): EditorState =>
  state.update({ selection: { anchor: pos } }).state;

export interface Press {
  state: EditorState;
  changed: boolean;
  handled: boolean;
}

export const USFM_KEYS = usfmKeys();

export const KEYMAP = [...USFM_KEYS, ...defaultKeymap];

/**
 * Runs one key binding against a bare state, with no view.
 *
 * The commands in `usfmKeys()` read `target.state` and call
 * `target.dispatch`, and nothing else — which is what makes them testable in
 * Node. This stands in for the view they are typed against.
 */
export function pressKey(state: EditorState, key: string): Press {
  let out: EditorState | null = null;
  const target = {
    state,
    dispatch: (tr: Transaction | TransactionSpec) => {
      out = "state" in tr ? tr.state : state.update(tr).state;
    },
  };
  // SAFETY: the bindings below are `usfmKeys()` and the default keymap, whose
  // commands touch only `state` and `dispatch` — both present above. A
  // command that reached for the DOM would throw here rather than mislead.
  const view = target as unknown as EditorView;
  for (const b of KEYMAP) {
    if (b.key !== key || !b.run) continue;
    target.state = out ?? state;
    if (b.run(view)) return { state: out ?? state, changed: !!out, handled: true };
  }
  return { state: out ?? state, changed: !!out, handled: false };
}

export const typeAt = (state: EditorState, pos: number, text: string): EditorState =>
  state.update({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: "input.type",
  }).state;

export const pasteAt = (state: EditorState, pos: number, text: string): EditorState =>
  state.update({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: "input.paste",
  }).state;

export function renderedText(state: EditorState): string {
  const doc = state.doc.toString();
  const events: [number, number, string][] = [];
  state.field(decoField).set.between(0, doc.length, (from, to, deco) => {
    if (to <= from && deco.spec.widget === undefined) return;
    if (deco.spec.widget !== undefined) events.push([from, to, "￼"]);
    else if (isInvisible(deco)) events.push([from, to, ""]);
  });
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let out = "";
  let cursor = 0;
  for (const [from, to, sub] of events) {
    if (from < cursor) continue;
    out += doc.slice(cursor, from) + sub;
    cursor = Math.max(cursor, to);
  }
  return out + doc.slice(cursor);
}

export function lineClassesOf(state: EditorState): Map<number, string[]> {
  const byPos = new Map<number, string[]>();
  state.field(decoField).set.between(0, state.doc.length, (from, to, deco) => {
    if (deco.spec.class && from === to)
      byPos.set(from, [...(byPos.get(from) ?? []), deco.spec.class]);
  });
  return byPos;
}

export function rendered(state: EditorState): string {
  const classes = [...lineClassesOf(state)]
    .sort((a, b) => a[0] - b[0])
    .map(([pos, cls]) => `${pos}:${cls.join(".")}`);
  return (classes.length ? `[${classes.join(" ")}] ` : "") + renderedText(state);
}

export function sameButForWhitespace(a: string, b: string): boolean {
  if (a === b) return true;
  let pre = 0;
  const shared = Math.min(a.length, b.length);
  while (pre < shared && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < shared - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return (
    isInsignificantWhitespace(a.slice(pre, a.length - suf)) &&
    isInsignificantWhitespace(b.slice(pre, b.length - suf))
  );
}

export const EDIT_KEYS = ["Enter", "Backspace", "Delete"] as const;

export const MOTION_KEYS = [
  "ArrowLeft",
  "ArrowRight",
  "Shift-ArrowLeft",
  "Shift-ArrowRight",
  "Alt-ArrowLeft",
  "Alt-ArrowRight",
] as const;

export const VIEW_MOTION_KEYS = ["Home", "End", "Mod-ArrowLeft", "Mod-ArrowRight"] as const;

const BS = "\\";

export const BODIES: readonly { readonly name: string; readonly body: string }[] = [
  {
    name: "markers each on their own line",
    body: `${BS}c 1\n${BS}s1 title\n${BS}p\n${BS}v 1 word one\n`,
  },
  { name: "everything on one line", body: `${BS}c 1 ${BS}s1 title ${BS}p ${BS}v 1 word one\n` },
  {
    name: "chapter alone, rest joined",
    body: `${BS}c 1\n${BS}s1 title ${BS}p ${BS}v 1 word one\n`,
  },
  {
    name: "heading alone, verse joined",
    body: `${BS}c 1\n${BS}s1 title\n${BS}p ${BS}v 1 word one\n`,
  },
  {
    name: "a DEAD designator, deliberately",
    body: `${BS}c 1\n${BS}s1 title\n${BS}p\n${BS}v  word one\n`,
  },
  {
    name: "an empty paragraph between",
    body: `${BS}c 1\n${BS}s1 title\n${BS}p\n${BS}p\n${BS}v 1 word one\n`,
  },
];

export const SCRIPTS: readonly { readonly name: string; readonly of: (t: string) => string }[] = [
  { name: "latin", of: (t) => t },
  { name: "hebrew", of: (t) => t.replace("word one", "הַשָּׁמַיִם וְאֵת") },
];

export interface Shape {
  name: string;
  doc: string;
}

export const SHAPES: readonly Shape[] = BODIES.flatMap((b) =>
  SCRIPTS.map((s) => ({ name: `${b.name} / ${s.name}`, doc: `${BS}id TST\n${s.of(b.body)}` })),
);

export function coincidentStops(state: EditorState): { from: number; to: number; bytes: string }[] {
  const set = state.field(decoField).set;
  const invisible: [number, number][] = [];
  set.between(0, state.doc.length, (from, to, deco) => {
    if (to > from && deco.spec.widget === undefined && isInvisible(deco))
      invisible.push([from, to]);
  });
  invisible.sort((a, b) => a[0] - b[0]);

  const allInvisible = (from: number, to: number): boolean => {
    let at = from;
    for (const [f, t] of invisible) {
      if (t <= at) continue;
      if (f > at) return false;
      at = Math.max(at, t);
      if (at >= to) return true;
    }
    return at >= to;
  };

  const out: { from: number; to: number; bytes: string }[] = [];
  const s = stops(state);
  for (let i = 1; i < s.length; i++) {
    const [from, to] = [s[i - 1], s[i]];
    let drawsSomething = false;
    set.between(from, to, (f, t, deco) => {
      if (t > f && deco.spec.widget !== undefined) drawsSomething = true;
    });
    if (!drawsSomething && allInvisible(from, to))
      out.push({ from, to, bytes: state.doc.sliceString(from, to) });
  }
  return out;
}

export const markupOnScreen = (state: EditorState): string[] | null =>
  renderedText(state).match(/\\[a-z]+[0-9]*/g);
