/**
 * Admission rule: a keystroke may not land inside markup the reader cannot see.
 *
 * Hidden markup has no glyphs to aim at, so a keystroke there is always an
 * accident of mapping rather than an intention. The rule reads the paint index —
 * not the decoration set — and answers in change-filter ranges.
 */

import { isUserReplacement } from "./deletion";
import { lineIndexAt, type DocStructure } from "./docStructure";
import {
  type GetPlan,
  type GetStructure,
  type PaintPort,
  NO_PAINT,
  isTrusted,
  isVisual,
  type ChangeRule,
} from "./kernel";
import { keyboardMutable, rowAt } from "./registry";
import { note } from "./trace";

const endsALine = (s: DocStructure, pos: number): boolean => {
  const i = lineIndexAt(s, pos);
  return i >= 0 && s.lines.toAt(i) === pos;
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
    const s = structureAt(state);
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
    const softLeft = (p: number) => p > 0 && ordinary(p - 1) && !endsALine(s, p - 1);
    const softRight = (p: number) => p < doc.length && ordinary(p) && !endsALine(s, p);
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
