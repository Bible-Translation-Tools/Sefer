/**
 * The stamp: a card's read-only body as STATIC HTML that is CodeMirror's own
 * rendering of it — a variant of `reader.ts`, measured beside it.
 *
 * One hidden "press" `EditorView`, off screen, renders a clip of a book with
 * the reader's exact extensions (the reading layer, the view layer, the
 * projection, the clip, the marks), and the card receives a deep copy of the
 * DOM it drew. There is no second renderer to keep in step with the editor:
 * the classes, the verse pips, the paragraph and poetry lines, the widgets are
 * the ones CodeMirror produced for that range a moment ago. What the copy is
 * not is live — no selection, no caret, no measuring — which is exactly what a
 * card at rest does not need, and what the satellite Edit opens provides.
 *
 * Why a variant and not the default: a card as a real view can later carry
 * what only a live view can (diagnostics on hover, a caret, the pairing
 * highlight). The stamp buys the cost of one view instead of twenty; this file
 * is here to measure that trade, switched by the "Result cards" setting.
 *
 * ## How a stamp is taken
 *
 * One transaction sets the press's clip, its render range and its marks; the
 * view updates its DOM synchronously on dispatch, and the lines inside the
 * clip are copied. A clip is pressed in slices of a few thousand characters,
 * because the press draws what fits its viewport and a whole chapter of
 * Psalms 119 does not; slices are whole lines, so they concatenate.
 *
 * The press keeps one state per parse and projection, so a list of forty
 * cards over three books switches state three times, not forty.
 */

import type { ChangeSet } from "@codemirror/state";
import { EditorState, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { sameSource, type Analysis } from "#core/galley";

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

/** Characters pressed per slice: well inside what the press draws at once. */
const SLICE = 6000;
/** How long typing must pause before a card the typing did not touch re-stamps. */
const CATCH_UP_MS = 400;

let press: EditorView | undefined;

const pressView = (): EditorView => {
  if (press !== undefined) return press;
  const frame = document.createElement("div");
  frame.setAttribute("aria-hidden", "true");
  frame.dataset["stampPress"] = "";
  // Off screen but laid out, at a card's width: CodeMirror draws what its
  // viewport holds, and a hidden (`display: none`) view draws nothing.
  frame.style.cssText = "position:fixed;left:-20000px;top:0;width:900px;pointer-events:none;";
  document.body.appendChild(frame);
  press = new EditorView({ parent: frame });
  return press;
};

/** The structure first built over each parse, lent to every later state of it. */
const lent = new WeakMap<Analysis, DocStructure>();
/** One state per parse and projection; the press is handed whichever a card needs. */
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

/** Where the press should be, then what it drew inside the clip. */
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
  const clip = wholeLines(doc, range);
  const lines: Node[] = [];
  let from = clip.from;
  while (from <= clip.to) {
    // A slice ends on a line end at or after SLICE characters, or at the clip's.
    const want = Math.min(clip.to, from + SLICE);
    const to = want >= clip.to ? clip.to : doc.lineAt(want).to;
    view.dispatch({
      effects: [clipEffect({ from, to }), setRenderRange.of({ from, to }), marksEffect(marks)],
    });
    for (const child of Array.from(view.contentDOM.children)) {
      // A line or a block widget the clip left standing; the collapsed book
      // around the clip is drawn as `cm-gap`-less empty blocks with no text.
      if (!(child instanceof HTMLElement)) continue;
      if (!child.classList.contains("cm-line") && child.textContent === "") continue;
      lines.push(child.cloneNode(true));
    }
    if (to >= clip.to) break;
    from = to + 1;
  }
  // The state after pressing is the one to hand back next time: states are
  // values, and the press has moved this one on.
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

  /** The press state for what this card shows now: the parse, or the seat's live text. */
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
      // The engine's hash and length, not a compare of the two texts.
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
