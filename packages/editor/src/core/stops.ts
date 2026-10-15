/**
 * Where the caret may legally stand — condition C1, stated exactly once.
 *
 * Every motion command and the settlement phase consume this, so "is this a
 * stop" has one answer in the whole editor. `settle(pos, direction)` is how an
 * illegal position becomes a legal one, which is the only way a caret ever
 * lands inside markup and comes back out.
 */

import { type EditorState, findClusterBreak } from "@codemirror/state";

import type { DocLine, DocStructure } from "./docStructure";
import { inDesignatorDelimiter } from "./exceptions";
import { type PaintPort, chromeForCaret, isVisual, lineAt } from "./kernel";
import { pipActive } from "./registry";

export type SettleDirection = "forward" | "backward" | "nearest";

export interface Stops {
  isStop(pos: number): boolean;
  settle(pos: number, toward: SettleDirection): number;
  pass(pos: number, forward: boolean): number;
  held(pos: number, origin: number): number;
  next(from: number, back: boolean): number | null;
}

const GUARD = 512;

const isBlankRow = (l: DocLine): boolean => l.cls === "blank" && l.contentFrom >= l.to;

interface PipApproach {
  readonly origin: number;
  readonly pos: number;
  readonly from: number;
  readonly to: number;
}

interface PipEndRule {
  readonly name: string;
  readonly when: (p: PipApproach) => boolean;
  readonly say: (p: PipApproach) => number;
}

const PIP_END_RULES: readonly PipEndRule[] = [
  { name: "came-from-the-left", when: (p) => p.origin <= p.from, say: (p) => p.from },
  { name: "came-from-the-right", when: (p) => p.origin >= p.to, say: (p) => p.to },
  { name: "nearer-the-left", when: (p) => p.pos - p.from <= p.to - p.pos, say: (p) => p.from },
  { name: "nearer-the-right", when: () => true, say: (p) => p.to },
];

const pipEnd = (p: PipApproach): number => {
  for (const rule of PIP_END_RULES) if (rule.when(p)) return rule.say(p);
  return p.to;
};

export function alignedOnACluster(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  const off = pos - line.from;
  const prev = findClusterBreak(line.text, off, false);
  return prev !== off && findClusterBreak(line.text, prev, true) !== off ? line.from + prev : pos;
}

export function stopsIn(state: EditorState, s: DocStructure, r: PaintPort): Stops {
  const end = state.doc.length;
  const visual = isVisual(state);

  const chromeStop = (l: DocLine, pos: number): number | null => {
    let p = pos;
    for (let guard = 0; guard < 8; guard++) {
      const c = chromeForCaret(l).find(
        (x) => (p > x.from && p < x.to) || (x.lean === "fwd" ? p === x.from : p === x.to),
      );
      if (!c) break;
      const next = c.lean === "fwd" ? c.to : c.from;
      if (next === p) break;
      p = next;
    }
    return p === pos ? null : p;
  };

  const atomAround = (l: DocLine, pos: number): { from: number; to: number } | null => {
    for (const a of r.atomic(state, l)) if (pos > a.from && pos < a.to) return a;
    return null;
  };

  let pipMemo: [number, number][] | null = null;
  const pips = (): [number, number][] => {
    if (pipMemo) return pipMemo;
    const out: [number, number][] = [];
    if (pipActive(state, "slot.v"))
      for (const v of s.verses)
        if (v.num !== null && v.contentFrom > v.markerFrom) out.push([v.markerFrom, v.contentFrom]);
    pipMemo = out;
    return out;
  };

  const pipAround = (pos: number): [number, number] | null => {
    for (const [a, b] of pips()) if (pos > a && pos < b) return [a, b];
    return null;
  };

  // Hidden AND drawing nothing in its place: no box, no join, no break widget.
  const hiddenAt = (p: number): boolean =>
    p >= 0 && p < end && r.hidden(state, p, p + 1) && !r.draws(state, p) && !r.joined(state, p);
  const isNewline = (p: number): boolean => p < end && state.doc.sliceString(p, p + 1) === "\n";
  // A line break the reader sees: a newline that is neither hidden nor joined.
  const visibleBreak = (p: number): boolean =>
    p >= end || (isNewline(p) && !hiddenAt(p) && !r.joined(state, p));

  /**
   * THE LINE-END RULE. When a line's visible text is followed by hidden
   * markup that runs up to the line break — a paragraph's end before a blank
   * line and a standalone `\s5`, a wrapper's hidden attributes — the stop is
   * the end of the VISIBLE text, and nothing between it and the break is one.
   * Answers that end for any position from it to the break, and `null`
   * anywhere else.
   *
   * It is the position admission lets an insertion through at (the run
   * begins there, and a change at a guarded run's edge is not inside it), so
   * the caret settlement leaves and the position typing is accepted at are
   * the same one. Before it, End and a click past the end landed one past the
   * text, strictly inside the run, where every keystroke and Insert footnote
   * was refused.
   */
  const visibleEnd = (pos: number): number | null => {
    let q = pos;
    for (let g = 0; g < GUARD && hiddenAt(q); g++) q++;
    if (!visibleBreak(q)) return null;
    let e = pos;
    for (let g = 0; g < GUARD && e > 0 && hiddenAt(e - 1); g++) e--;
    if (e === q || e === 0) return null;
    // The run starts a line (the char before it is a line break the reader
    // sees): there is no visible text on this line to end.
    if (isNewline(e - 1) && !r.joined(state, e - 1)) return null;
    return e;
  };
  // Only a position at a hidden run, or at a break right after one, can be in
  // the rule's reach; everything else skips the scan.
  const nearALineEndRun = (pos: number): boolean =>
    hiddenAt(pos) ||
    (pos > 0 && isNewline(pos) && hiddenAt(pos - 1)) ||
    (pos >= end && hiddenAt(pos - 1));

  const isStop = (pos: number): boolean => {
    if (!visual) return true;
    const l = lineAt(s, state, pos);
    if (!l) return true;
    if (isBlankRow(l)) return false;
    if (r.draws(state, pos)) return true;
    if (alignedOnACluster(state, pos) !== pos) return false;
    if (chromeStop(l, pos) !== null) return false;
    if (atomAround(l, pos)) return false;
    if (pipAround(pos)) return false;
    if (nearALineEndRun(pos)) {
      const e = visibleEnd(pos);
      if (e !== null) return e === pos;
    }
    if (inDesignatorDelimiter(s, pos)) return true;
    if (r.joined(state, pos)) return true;
    if (pos >= end) return true;
    return !r.hidden(state, pos, pos + 1);
  };

  const paintStep = (pos: number): number => {
    const l = lineAt(s, state, pos);
    if (!l) return pos;
    if (isBlankRow(l)) return Math.min(l.to + 1, end);
    if (r.draws(state, pos)) return pos;
    const c = chromeStop(l, pos);
    if (c !== null) return c;
    if (inDesignatorDelimiter(s, pos)) return pos;
    if (pos >= end) return pos;
    if (!r.hidden(state, pos, pos + 1)) return pos;
    return pos + 1;
  };

  const walkAhead = (pos: number): number => {
    let p = pos;
    for (let guard = 0; guard < GUARD; guard++) {
      const step = paintStep(p);
      if (step === p) break;
      p = step;
    }
    return p;
  };

  const settle = (pos: number, toward: SettleDirection): number => {
    if (!visual || isStop(pos)) return pos;
    // Between a line's visible end and its break, every direction means the
    // same place on screen: that end. An arrow key that wants the next line
    // keeps stepping (`moveCaret` does), so this never traps one.
    if (nearALineEndRun(pos)) {
      const e = visibleEnd(pos);
      if (e !== null) return e;
    }
    if (toward === "forward") return walkAhead(pos);
    const back = next(pos, true);
    if (back === null) return walkAhead(pos);
    if (toward === "backward") return back;
    const ahead = walkAhead(pos);
    return ahead - pos <= pos - back ? ahead : back;
  };

  const held = (pos: number, origin: number): number => {
    const l = lineAt(s, state, pos);
    let p = pos;
    if (l) {
      const a = atomAround(l, p);
      if (a) p = p - a.from <= a.to - p ? a.from : a.to;
    }
    const pip = pipAround(p);
    if (pip) p = pipEnd({ origin, pos: p, from: pip[0], to: pip[1] });
    return p;
  };

  const pass = (pos: number, forward: boolean): number => {
    const l = lineAt(s, state, pos);
    let p = pos;
    if (l)
      for (const a of r.atomic(state, l)) if (p > a.from && p < a.to) p = forward ? a.to : a.from;
    for (const [a, b] of pips()) if (p > a && p < b) p = forward ? b : a;
    return p;
  };

  const next = (from: number, back: boolean): number | null => {
    for (let g = 1; g <= GUARD; g++) {
      const p = back ? from - g : from + g;
      if (p < 0 || p > end) return null;
      if (isStop(p)) return p;
    }
    return null;
  };

  return { isStop, settle, pass, held, next };
}
