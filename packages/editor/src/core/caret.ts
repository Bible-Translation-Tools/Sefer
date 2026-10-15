/**
 * Caret motion and the settlement phase: every arrow, Home/End and word jump
 * consumes `stops.ts`, and every transaction ends with the caret on a legal
 * position.
 *
 * Motion is a command (the user asked) and settlement is a rule (the editor
 * insists); both are here so the definition of "legal" is read from one place.
 */

import {
  EditorSelection,
  EditorState,
  findClusterBreak,
  type SelectionRange,
} from "@codemirror/state";
import { type Command, Direction, EditorView } from "@codemirror/view";

import type { DocStructure } from "./docStructure";
import {
  type GetStructure,
  type PaintPort,
  NO_PAINT,
  isVisual,
  type TransactionRule,
} from "./kernel";
import { alignedOnACluster, stopsIn, type SettleDirection } from "./stops";
import { note, noteTr } from "./trace";

export function lawfulStop(
  state: EditorState,
  s: DocStructure,
  r: PaintPort,
  from: number,
  back: boolean,
): number | null {
  return stopsIn(state, s, r).next(from, back);
}

export function canonicalCaret(
  state: EditorState,
  s: DocStructure,
  pos: number,
  r: PaintPort = NO_PAINT,
): number {
  return stopsIn(state, s, r).settle(pos, "forward");
}

type Step = (view: EditorView, at: number, forward: boolean) => number;

const byChar: Step = (view, at, fwd) => {
  const doc = view.state.doc;
  const line = doc.lineAt(at);
  if (fwd)
    return at >= line.to
      ? Math.min(doc.length, at + 1)
      : line.from + findClusterBreak(line.text, at - line.from, true);
  return at <= line.from
    ? Math.max(0, at - 1)
    : line.from + findClusterBreak(line.text, at - line.from, false);
};

const byGroup: Step = (view, at, fwd) => {
  const categorize = view.state.charCategorizer(at);
  const doc = view.state.doc;
  let p = at;
  let group: unknown = null;
  for (let i = 0; i < 1024; i++) {
    const next = byChar(view, p, fwd);
    if (next === p) return p;
    const ch = doc.sliceString(Math.min(p, next), Math.max(p, next));
    const cat = categorize(ch);
    if (group === null) group = cat;
    else if (cat !== group) return p;
    if (/^\s*$/.test(ch)) group = null;
    p = next;
  }
  return p;
};

function moveTheCaretOneStopInDocumentOrder(
  view: EditorView,
  s: DocStructure,
  startSel: SelectionRange,
  visualRight: boolean,
  step: Step,
  r: PaintPort,
): SelectionRange | null {
  const from = startSel.head;
  const docForward = visualRight;
  const stops = stopsIn(view.state, s, r);

  let p = from;
  for (let guard = 0; guard < 256; guard++) {
    const next = step(view, p, docForward);
    if (next === p) {
      note(view.state, {
        rule: "moveCaret",
        verdict: "consumed",
        detail: `${visualRight ? "→" : "←"} from ${from}, ${docForward ? "forward" : "back"} — the document has ended`,
      });
      return startSel;
    }
    p = next;

    const c = stops.settle(stops.pass(p, docForward), docForward ? "forward" : "backward");
    if (c !== from && stops.isStop(c)) {
      note(view.state, {
        rule: "moveCaret",
        verdict: "moved",
        detail: `${visualRight ? "→" : "←"} ${from} → ${c} (stepped to ${next}, ${docForward ? "forward" : "back"})`,
      });
      return EditorSelection.cursor(c);
    }
  }
  note(view.state, {
    rule: "moveCaret",
    verdict: "consumed",
    detail: `${visualRight ? "→" : "←"} from ${from} — GUARD EXHAUSTED after 256 steps`,
  });
  return startSel;
}

export function moveCaret(
  structureAt: GetStructure,
  visualRight: boolean,
  step: Step = byChar,
  r: PaintPort = NO_PAINT,
): Command {
  return (view) => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const to = moveTheCaretOneStopInDocumentOrder(
      view,
      structureAt(view.state),
      sel,
      visualRight,
      step,
      r,
    );
    if (to === null) return false;
    if (to.head === sel.head && to.assoc === sel.assoc) return true;
    view.dispatch({
      selection: EditorSelection.cursor(to.head, to.assoc),
      scrollIntoView: true,
    });
    return true;
  };
}

export function moveCaretByWord(
  structureAt: GetStructure,
  visualRight: boolean,
  r: PaintPort = NO_PAINT,
): Command {
  return moveCaret(structureAt, visualRight, byGroup, r);
}

export function caretLineBoundary(
  structureAt: GetStructure,
  end: boolean,
  r: PaintPort = NO_PAINT,
): Command {
  return (view) => {
    const sel = view.state.selection.main;
    if (view.textDirectionAt(sel.head) !== Direction.LTR) return false;
    const at = view.moveToLineBoundary(EditorSelection.cursor(sel.head), end, true).head;
    const to = stopsIn(view.state, structureAt(view.state), r).settle(
      at,
      end ? "forward" : "backward",
    );
    note(view.state, {
      rule: "caretLineBoundary",
      verdict: to === sel.head ? "passed" : "moved",
      detail: `${end ? "End" : "Home"} ${sel.head} → ${to} (line boundary ${at}, settled ${end ? "forward" : "backward"})`,
    });
    view.dispatch({ selection: EditorSelection.cursor(to), scrollIntoView: true });
    return true;
  };
}

export function extendCaret(
  structureAt: GetStructure,
  visualRight: boolean,
  step: Step = byChar,
  r: PaintPort = NO_PAINT,
): Command {
  return (view) => {
    const sel = view.state.selection.main;
    const to = moveTheCaretOneStopInDocumentOrder(
      view,
      structureAt(view.state),
      sel,
      visualRight,
      step,
      r,
    );
    if (to === null) return false;
    if (to.head === sel.head && to.assoc === sel.assoc) return true;
    note(view.state, {
      rule: "extendCaret",
      verdict: "moved",
      detail: `${visualRight ? "→" : "←"} anchor ${sel.anchor}, head ${sel.head} → ${to.head}`,
    });
    view.dispatch({
      selection: EditorSelection.range(sel.anchor, to.head),
      scrollIntoView: true,
    });
    return true;
  };
}

export function settleTheCaretOnALegalPosition(
  structureAt: GetStructure,
  r: PaintPort = NO_PAINT,
): TransactionRule {
  return (tr) => {
    if (!tr.selection && !tr.docChanged) return tr;
    if (!isVisual(tr.state)) return tr;
    const sel = tr.state.selection.main;
    if (!sel.empty) return tr;
    const stops = stopsIn(tr.state, structureAt(tr.state), r);

    const resolve = (toward: SettleDirection): number => {
      let c = sel.head;
      for (let round = 0; round < 8; round++) {
        const started = c;
        c = stops.held(stops.settle(alignedOnACluster(tr.state, c), toward), started);
        if (c === started) break;
      }
      return c;
    };

    const came = tr.startState.selection.main.head;
    const toward: SettleDirection = tr.docChanged
      ? "forward"
      : sel.head > came
        ? "forward"
        : sel.head < came
          ? "backward"
          : "nearest";
    const c = resolve(toward);
    if (c === sel.head) return tr;
    noteTr(tr, {
      rule: "settleTheCaretOnALegalPosition",
      verdict: "moved",
      detail: `${sel.head} → ${c} (not a caret stop)`,
    });
    return [tr, { selection: { anchor: c }, sequential: true }];
  };
}
