import { note } from "../instrument/trace";
import {
  type GetPlan,
  type GetStructure,
  type PaintPort,
  NO_PAINT,
  isTrusted,
  isVisual,
  type ChangeRule,
} from "../kernel";
import { lineIndexAt, type DocStructure } from "../model/docStructure";
import { keyboardMutable, rowAt } from "../model/registry";
import { surfaceRangeAt } from "./clip";
import { isUserReplacement } from "./deletion";

const endsALine = (structure: DocStructure, pos: number): boolean => {
  const i = lineIndexAt(structure, pos);
  return i >= 0 && structure.lines.toAt(i) === pos;
};

/**
 * A paste of whole lines at a line's start: it puts lines BEFORE the markup
 * that opens the line, not inside it, so the marker still opens its line
 * after it. How a heading pasted at a verse's first word lands above the
 * verse's `\v` (`core/clipboard.ts`).
 */
const pastesWholeLinesAt = (tr: Parameters<ChangeRule>[0], at: number): boolean => {
  if (!tr.isUserEvent("input.paste")) return false;
  if (at > 0 && tr.startState.doc.sliceString(at - 1, at) !== "\n") return false;
  let whole = true;
  tr.changes.iterChanges((_fA, _tA, _fB, _tB, ins) => {
    whole &&= ins.length > 0 && ins.line(ins.lines).length === 0;
  });
  return whole;
};

const mergedPairs = (out: readonly number[]): number[] => {
  const pairs: [number, number][] = [];
  for (let i = 0; i < out.length; i += 2) pairs.push([out[i], out[i + 1]]);
  pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: number[] = [];
  for (const [a, b] of pairs) {
    const end = merged.length - 1;
    if (merged.length && a < merged[end]) merged[end] = Math.max(merged[end], b);
    else merged.push(a, b);
  }
  return merged;
};

export function refuseKeystrokesInsideHiddenMarkup(
  structureAt: GetStructure,
  plansAt: GetPlan,
  r: PaintPort = NO_PAINT,
): ChangeRule {
  return (tr) => {
    if (isTrusted(tr) || !isVisual(tr.startState)) return true;
    let deletes = false;
    let lo = Infinity;
    let hi = -1;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (toA > fromA) deletes = true;
      lo = Math.min(lo, fromA);
      hi = Math.max(hi, toA);
    });
    if (hi < 0 || (deletes && isUserReplacement(tr))) return true;
    const state = tr.startState;
    const surface = surfaceRangeAt(state);
    if (
      !deletes &&
      surface !== null &&
      surface.from === surface.to &&
      lo === surface.from &&
      hi === lo
    )
      return true;
    if (!deletes && lo === hi && pastesWholeLinesAt(tr, lo)) return true;
    const structure = structureAt(state);
    const doc = state.doc;
    const out: number[] = [];
    const push = (from: number, to: number) => {
      if (to > from && from <= hi && to >= lo) out.push(from, to);
    };

    const CAP = 256;
    const isHidden = (at: number) => at >= 0 && at < doc.length && r.hidden(state, at, at + 1);
    let at = lo;
    for (let g = 0; g < CAP && isHidden(at - 1); g++) at--;
    while (at <= hi) {
      if (!isHidden(at)) {
        at++;
        continue;
      }
      const from = at;
      for (let g = 0; g < CAP && isHidden(at); g++) at++;
      push(from, at);
      if (at === from) break;
    }

    const scanFrom = Math.max(0, lo - 1);
    const hits = plansAt(state)
      .targets()
      .targetsIn(scanFrom, Math.max(Math.min(doc.length, hi + 1), scanFrom + 1)).hits;
    const inMarkup = (p: number) =>
      hits.some((h) => h.target.hiddenSpans.some((sp) => sp.from <= p && sp.to > p));
    const ordinary = (p: number) => !isHidden(p) && !inMarkup(p);
    const softLeft = (p: number) => p > 0 && ordinary(p - 1) && !endsALine(structure, p - 1);
    const softRight = (p: number) => p < doc.length && ordinary(p) && !endsALine(structure, p);
    let breakFirst = true;
    let breakLast = true;
    tr.changes.iterChanges((_fA, _tA, _fB, _tB, ins) => {
      if (!ins.length) return;
      breakFirst &&= ins.line(1).length === 0;
      breakLast &&= ins.line(ins.lines).length === 0;
    });
    for (const h of hits) {
      const t = h.target;
      if (t.paint !== "point" || keyboardMutable(rowAt(state, t.cls))) continue;
      for (const sp of t.paintedSpans)
        if (deletes) push(sp.from, sp.to);
        else
          push(
            softLeft(sp.from) || breakLast ? sp.from : Math.max(0, sp.from - 1),
            softRight(sp.to) || breakFirst ? sp.to : Math.min(doc.length, sp.to + 1),
          );
    }

    if (!out.length) return true;
    const merged = mergedPairs(out);
    note(state, {
      rule: "refuseKeystrokesInsideHiddenMarkup",
      verdict: "passed",
      detail: `guarding ${merged.length / 2} range(s): ${merged.join(",")} — a change strictly inside one is dropped`,
    });
    return merged;
  };
}
