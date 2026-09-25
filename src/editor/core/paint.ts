/**
 * The positional paint index: `hidden(from, to)`, `draws(pos)`, `joined(pos)`,
 * `joinOver(pos)`, `atomic(line)`.
 *
 * A plan says what each row draws; this answers the same questions BY POSITION,
 * which is what the caret, the deletion rules and the linter actually ask. Built
 * over one structure and plan, cached per state (`paintAt`), and deliberately
 * independent of the decoration set — a rule that consulted the decorations
 * would be reading the screen instead of the model.
 */

import { lineIndexAt, type DocStructure } from "./docStructure";
import type { DocPlan, PlanSpan } from "./plan";

export interface PaintIndex {
  hidden(from: number, to: number): boolean;
  draws(pos: number): boolean;
  joined(pos: number): boolean;
  /**
   * The join whose newline or held lines cover `pos`: from its newline to the
   * end of the blank and passthrough lines it holds. Null if none does.
   */
  joinOver(pos: number): PlanSpan | null;
}

type Gather = (out: number[], from: number, t: number) => void;

export function paintOver(s: DocStructure, plan: DocPlan): PaintIndex {
  if (plan.revision !== s.revision)
    throw new Error(`stale plan: revision ${plan.revision} over a fold at ${s.revision}`);
  const lines = s.lines;
  const blocks = s.blocks;
  const verses = s.verses;

  const lineAt = (pos: number): number => lineIndexAt(s, pos);

  const emit = (out: number[], a: number, b: number, from: number, t: number) => {
    if (b > a && b > from && a < t) out.push(a, b);
  };

  const firstVerseFrom = (pos: number): number => {
    let lo = 0;
    let hi = verses.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (verses[mid].markerFrom < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const slots: Gather = (out, qf, qt) => {
    const a = lineAt(qf - 1);
    if (a < 0) return;
    const b = lineAt(qt);
    for (let i = a; i <= b; i++) {
      const slot = plan.line(i + 1).slot;
      if (slot) for (const h of slot.hidden) emit(out, h.from, h.to, qf, qt);
    }
    for (let k = firstVerseFrom(lines.fromAt(a)); k < verses.length; k++) {
      if (verses[k].markerFrom > lines.toAt(b)) break;
      for (const h of plan.verse(k).hidden) emit(out, h.from, h.to, qf, qt);
    }
  };

  const overLines =
    (of: (n: number) => readonly { from: number; to: number }[]): Gather =>
    (out, qf, qt) => {
      const a = lineAt(qf - 1);
      if (a < 0) return;
      const b = lineAt(qt);
      for (let i = a; i <= b; i++) for (const h of of(i + 1)) emit(out, h.from, h.to, qf, qt);
    };

  const NONE: readonly { from: number; to: number }[] = [];
  const heads = overLines((n) => plan.line(n).hidden);
  // What a line hides that is not its opener's chrome: a standalone marker
  // that opens it, and any point mark (milestone, optional break, standalone)
  // the assignment does not draw.
  const marks = overLines((n) => {
    const rl = plan.line(n);
    const c = rl.standalone;
    const own = c && c.form === "hidden" ? [c] : NONE;
    const hiddenMarks = rl.marks.filter((m) => m.form === "hidden");
    return hiddenMarks.length ? [...own, ...hiddenMarks] : own;
  });

  // Triples: a join's newline `from, to`, and where the lines it holds end —
  // the hide span `closeGap` pushes right after it, or the join's own end.
  const joinMemo: (number[] | null)[] = Array.from({ length: blocks.length }, () => null);
  const blockJoins = (i: number): number[] => {
    let g = joinMemo[i];
    if (g) return g;
    g = [];
    const reflow = plan.block(i).reflow;
    reflow.forEach((r, k) => {
      if (r.kind !== "join") return;
      const held = reflow[k + 1];
      g?.push(r.from, r.to, held && held.kind === "hide" && held.from === r.to ? held.to : r.to);
    });
    joinMemo[i] = g;
    return g;
  };

  const joinOf = (pos: number, reach: 1 | 2): PlanSpan | null => {
    if (!blocks.length) return null;
    const r = reachOf();
    for (let i = lastBlockOnLineOf(pos); i >= 0 && r[i] > pos; i--) {
      const g = blockJoins(i);
      for (let k = 0; k < g.length; k += 3)
        if (g[k] <= pos && g[k + reach] > pos) return { from: g[k], to: g[k + 2] };
    }
    return null;
  };

  const blockMemo: (number[] | null)[] = Array.from({ length: blocks.length }, () => null);
  const blockHides = (i: number): number[] => {
    let g = blockMemo[i];
    if (g) return g;
    g = [];
    const rb = plan.block(i);
    for (const r of rb.reflow) if (r.kind === "hide") g.push(r.from, r.to);
    if (rb.headHidden) g.push(rb.headHidden.from, rb.headHidden.to);
    blockMemo[i] = g;
    return g;
  };

  let reach: Float64Array | null = null;
  const reachOf = (): Float64Array => {
    if (reach) return reach;
    const r = new Float64Array(blocks.length);
    let max = -1;
    for (let i = 0; i < blocks.length; i++) {
      const end = lines.toAt(blocks.lastAt(i) - 1) + 1;
      if (end > max) max = end;
      r[i] = max;
    }
    reach = r;
    return r;
  };

  const lastBlockOnLineOf = (pos: number): number => {
    const i = lineAt(pos);
    const edge = i < 0 ? pos : lines.toAt(i);
    let lo = 0;
    let hi = blocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (blocks.fromAt(mid) <= edge) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  };

  const blockGroup: Gather = (out, qf, qt) => {
    if (!blocks.length) return;
    const r = reachOf();
    for (let i = lastBlockOnLineOf(qt); i >= 0 && r[i] > qf; i--) {
      const g = blockHides(i);
      for (let k = 0; k < g.length; k += 2) emit(out, g[k], g[k + 1], qf, qt);
    }
  };

  const near = (gather: Gather, from: number, t: number): boolean => {
    const g: number[] = [];
    gather(g, from, t);
    if (!g.length) return false;
    merge(g);
    return covers(g, from, t);
  };

  let noteHides: number[] | null = null;
  let wordHides: number[] | null = null;
  const whole = (of: "notes" | "words"): number[] => {
    const held = of === "notes" ? noteHides : wordHides;
    if (held) return held;
    const g: number[] = [];
    const source = of === "notes" ? plan.notes : plan.words;
    for (const r of source) for (const h of r.hidden) if (h.to > h.from) g.push(h.from, h.to);
    merge(g);
    if (of === "notes") noteHides = g;
    else wordHides = g;
    return g;
  };

  let apparatus: Set<number> | null = null;
  const apparatusBoxes = (): Set<number> => {
    if (apparatus) return apparatus;
    apparatus = new Set<number>();
    for (const ap of plan.apparatus) apparatus.add(ap.at);
    return apparatus;
  };

  return {
    hidden(from: number, to: number): boolean {
      const t = Math.max(to, from + 1);
      if (near(slots, from, t)) return true;
      if (near(heads, from, t)) return true;
      if (near(marks, from, t)) return true;
      if (covers(whole("notes"), from, t)) return true;
      if (covers(whole("words"), from, t)) return true;
      return near(blockGroup, from, t);
    },
    joined: (pos) => joinOf(pos, 1) !== null,
    joinOver: (pos) => joinOf(pos, 2),
    draws(pos: number): boolean {
      if (apparatusBoxes().has(pos)) return true;
      const i = lineAt(pos);
      if (i < 0) return false;
      const from = lines.fromAt(i);
      const to = lines.toAt(i);
      const slot = plan.line(i + 1).slot;
      if (slot && slot.box === pos) return true;
      for (let k = firstVerseFrom(from); k < verses.length; k++) {
        if (verses[k].markerFrom > to) break;
        if (plan.verse(k).box === pos) return true;
      }
      if (from === pos) return false;
      for (let b = lastBlockOnLineOf(pos); b >= 0 && blocks.fromAt(b) >= pos; b--)
        if (plan.block(b).breakAt === pos) return true;
      return false;
    },
  };
}

function merge(g: number[]): void {
  const pairs: [number, number][] = [];
  for (let i = 0; i < g.length; i += 2) pairs.push([g[i], g[i + 1]]);
  pairs.sort((a, b) => a[0] - b[0]);
  g.length = 0;
  let end = -1;
  for (const [a, b] of pairs) {
    if (a > end) {
      g.push(a, b);
      end = b;
    } else if (b > end) {
      g[g.length - 1] = b;
      end = b;
    }
  }
}

function covers(g: number[], from: number, t: number): boolean {
  let lo = 0;
  let hi = g.length / 2 - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (g[mid * 2] <= from) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && g[found * 2 + 1] >= t;
}
