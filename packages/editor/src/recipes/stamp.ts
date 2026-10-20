import type { ChangeSet } from "@codemirror/state";
import { EditorState, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sameSource, type Analysis } from "@sefer/text/engine/analysis";

import { analyzer } from "../core/analyzer";
import { readingLayer, viewLayer } from "../core/compose";
import { borrowedStructure, structureAt, type DocStructure } from "../core/docStructure";
import { renderRangeField, setRenderRange } from "../core/render";
import { span } from "../core/timing";
import type { Funnel } from "../funnel";
import { policyKey, policyView, type EditorPolicy } from "../views";
import {
  clipEffect,
  clipped,
  markedRanges,
  marksEffect,
  clipSpan,
  wholeLines,
  type MarkedRange,
} from "./satellite";

export interface StampOptions {
  readonly parent: HTMLElement;
  readonly analysis: Analysis;
  readonly range: { readonly from: number; readonly to: number };
  /** How the stamp draws: the surface's behaviour matrix (`editorPolicy`). */
  readonly policy: EditorPolicy;
  readonly marks: readonly MarkedRange[];
  readonly surface: string;
  readonly label: string;
}

export interface StampMount {
  setPolicy(policy: EditorPolicy): void;
  reclip(range: { readonly from: number; readonly to: number }): void;
  remark(marks: readonly MarkedRange[]): void;
  /** Follow a seat: re-stamp from its text as it changes. See `ReaderMount.follow`. */
  follow(host: Funnel | undefined): boolean;
  destroy(): void;
}

const SLICE = 6000;
const CATCH_UP_MS = 400;

let press: EditorView | undefined;

const pressView = (): EditorView => {
  if (press !== undefined) return press;
  const frame = document.createElement("div");
  frame.setAttribute("aria-hidden", "true");
  frame.dataset["stampPress"] = "";
  frame.style.cssText = "position:fixed;left:-20000px;top:0;width:900px;pointer-events:none;";
  document.body.appendChild(frame);
  press = new EditorView({ parent: frame });
  return press;
};

const lent = new WeakMap<Analysis, DocStructure>();
const states = new WeakMap<object, Map<string, EditorState>>();

const stateFor = (
  key: object,
  doc: string | Text,
  parse: () => DocStructure | null,
  analyze: () => Analysis,
  policy: EditorPolicy,
  surface: string,
): EditorState => {
  const name = `${policyKey(policy)} ${surface}`;
  let byMode = states.get(key);
  if (byMode === undefined) {
    byMode = new Map();
    states.set(key, byMode);
  }
  const held = byMode.get(name);
  if (held !== undefined) return held;
  const start = { from: 0, to: 0 };
  const made = EditorState.create({
    doc,
    extensions: [
      analyzer.of(analyze),
      borrowedStructure.of(parse),
      readingLayer,
      viewLayer(),
      policyView(policy, surface),
      clipped(start),
      renderRangeField.init(() => start),
      markedRanges([]),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  });
  byMode.set(name, made);
  return made;
};

const pressRange = (
  state: EditorState,
  key: object,
  policy: EditorPolicy,
  surface: string,
  range: { readonly from: number; readonly to: number },
  marks: readonly MarkedRange[],
): {
  readonly outer: string;
  readonly scroller: string;
  readonly content: string;
  readonly lines: Node[];
} => {
  const view = pressView();
  if (view.state !== state) view.setState(state);
  const doc = view.state.doc;
  const clip = clipSpan(doc, range);
  const lines: Node[] = [];
  let from = clip.from;
  while (from <= clip.to) {
    const want = Math.min(clip.to, from + SLICE);
    const to = want >= clip.to ? clip.to : doc.lineAt(want).to;
    view.dispatch({
      effects: [
        clipEffect({ from, to }),
        setRenderRange.of(wholeLines(doc, { from, to })),
        marksEffect(marks),
      ],
    });
    for (const child of Array.from(view.contentDOM.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (!child.classList.contains("cm-line") && child.textContent === "") continue;
      lines.push(child.cloneNode(true));
    }
    if (to >= clip.to) break;
    from = to + 1;
  }
  const byMode = states.get(key);
  byMode?.set(`${policyKey(policy)} ${surface}`, view.state);
  return {
    outer: view.dom.className,
    scroller: view.scrollDOM.className,
    content: view.contentDOM.className,
    lines,
  };
};

const draw = (parent: HTMLElement, taken: ReturnType<typeof pressRange>): void => {
  const outer = document.createElement("div");
  outer.className = taken.outer;
  outer.dataset["stamp"] = "";
  const scroller = document.createElement("div");
  scroller.className = taken.scroller;
  const content = document.createElement("div");
  content.className = taken.content;
  content.append(...taken.lines);
  scroller.append(content);
  outer.append(scroller);
  parent.replaceChildren(outer);
};

const mapMarks = (marks: readonly MarkedRange[], changes: ChangeSet): readonly MarkedRange[] =>
  marks.map((mark) => ({
    ...mark,
    from: changes.mapPos(mark.from, 1),
    to: changes.mapPos(mark.to, -1),
  }));

export function mountStamp(options: StampOptions): StampMount {
  const { analysis, surface } = options;
  let policy = options.policy;
  let range = options.range;
  let marks = options.marks;
  let followed: Funnel | undefined;
  let detach: (() => void) | undefined;
  let frame: number | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;

  const current = (): { state: EditorState; key: object } => {
    const host = followed;
    if (host !== undefined) {
      const doc = host.doc();
      return {
        key: doc,
        state: stateFor(
          doc,
          doc,
          () => host.structure(),
          () => analysis,
          policy,
          surface,
        ),
      };
    }
    return {
      key: analysis,
      state: stateFor(
        analysis,
        analysis.text,
        () => lent.get(analysis) ?? null,
        () => analysis,
        policy,
        surface,
      ),
    };
  };

  const stamp = (): void => {
    frame = undefined;
    idle = undefined;
    const done = span("stamp", options.label);
    const { state, key } = current();
    if (!lent.has(analysis) && followed === undefined) lent.set(analysis, structureAt(state));
    draw(options.parent, pressRange(state, key, policy, surface, range, marks));
    done();
  };

  stamp();

  const stop = (): void => {
    detach?.();
    detach = undefined;
    followed = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (idle !== undefined) clearTimeout(idle);
    frame = undefined;
    idle = undefined;
  };

  return {
    setPolicy: (next) => {
      if (policyKey(next) === policyKey(policy)) return;
      policy = next;
      stamp();
    },
    reclip: (next) => {
      if (next.from === range.from && next.to === range.to) return;
      range = next;
      stamp();
    },
    remark: (next) => {
      if (next === marks) return;
      marks = next;
      stamp();
    },
    follow: (host) => {
      stop();
      if (host === undefined) return true;
      const seated = host.structure().analysis;
      if (seated === undefined || seated === null || !sameSource(seated, analysis)) return false;
      followed = host;
      detach = host.attach((changes) => {
        const touched = changes.touchesRange(range.from, range.to) !== false;
        range = { from: changes.mapPos(range.from, -1), to: changes.mapPos(range.to, 1) };
        marks = mapMarks(marks, changes);
        if (touched) {
          if (frame === undefined) frame = requestAnimationFrame(stamp);
        } else {
          if (idle !== undefined) clearTimeout(idle);
          idle = setTimeout(stamp, CATCH_UP_MS);
        }
      });
      return true;
    },
    destroy: () => {
      stop();
      options.parent.replaceChildren();
    },
  };
}
