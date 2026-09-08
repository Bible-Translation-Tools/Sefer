/**
 * Protection: markers are deleted whole or not at all.
 *
 * The interesting part is the shape, not the policy — a deletion is planned over
 * a WIDENED range (what the keystroke actually addresses, including the markup
 * that owns the glyph next to it), a verdict is taken over the ORIGINAL range
 * (what the user consented to), and the result is one of pass, refuse,
 * write-around or rewrite. Backspace and Delete are two dispatchers over the
 * same target data and share one commit shell, so the two keys cannot disagree.
 */

import { EditorState, type StateCommand, type Transaction } from "@codemirror/state";

import { lawfulStop } from "./caret";
import { isBlankLine, lineIndexAt, opensAParagraph, type DocStructure } from "./docStructure";
import {
  type GetPlan,
  type GetStructure,
  type PaintPort,
  NO_PAINT,
  isTrusted,
  isVisual,
  lineAt,
  trusted,
  atContentHead,
  type TransactionRule,
} from "./kernel";
import type { Addressed, OwnedIndex, ResolvedOwnedTarget } from "./owned";
import type { PlanSpan } from "./plan";
import { note, noteTr, type Verdict as TraceVerdict } from "./trace";

function spaceBefore(state: EditorState, at: number): string {
  const next = state.doc.sliceString(at, at + 1);
  return next === "" || next === "\\" || /\s/.test(next) ? "" : " ";
}

function weld(s: DocStructure, state: EditorState, from: number, to: number): string {
  return atContentHead(s, state, from) ? spaceBefore(state, to) : "";
}

const startsALine = (s: DocStructure, pos: number): boolean => {
  const i = lineIndexAt(s, pos);
  return i >= 0 && s.lines.fromAt(i) === pos;
};

const anchoredBack = (s: DocStructure, sp: PlanSpan): PlanSpan =>
  sp.from > 0 && startsALine(s, sp.from) ? { from: sp.from - 1, to: sp.to } : sp;

function reachesImmortal(ix: OwnedIndex, s: DocStructure, from: number, to: number): boolean {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (const h of ix.targetsIn(lo, hi + 1).hits) {
    if (h.target.mutability !== "immortal") continue;
    const a = anchoredBack(s, h.target.wholeSpan);
    if (a.to > lo && a.from < hi) return true;
  }
  return false;
}

function immortalGuard(
  state: EditorState,
  s: DocStructure,
  ix: OwnedIndex,
  r: PaintPort,
  at: number,
  back: boolean,
  raw: (tr: Transaction) => void,
): (tr: Transaction) => void {
  return (tr) => {
    let hits = false;
    tr.changes.iterChanges((fromA, toA) => {
      if (!hits && toA > fromA && reachesImmortal(ix, s, fromA, toA)) hits = true;
    });
    if (hits) consumePress(state, s, r, at, back, raw);
    else raw(tr);
  };
}

function consumePress(
  state: EditorState,
  s: DocStructure,
  r: PaintPort,
  at: number,
  back: boolean,
  dispatch: (tr: Transaction) => void,
): boolean {
  const to = lawfulStop(state, s, r, at, back);
  if (to !== null && to !== at)
    dispatch(
      state.update({
        selection: { anchor: to },
        userEvent: "select.usfm.pastImmortal",
        scrollIntoView: true,
      }),
    );
  return true;
}

export type Verdict =
  | { readonly act: "nothing"; readonly say: string }
  | { readonly act: "consume"; readonly say: string }
  | { readonly act: "default"; readonly say: string }
  | {
      readonly act: "cut";
      readonly from: number;
      readonly to: number;
      readonly event: string;
      readonly seal: string | null;
      readonly say: string;
    };

const TRACED: Record<Verdict["act"], TraceVerdict> = {
  nothing: "refused",
  consume: "consumed",
  default: "declined",
  cut: "rewrote",
};

const cutTo = (
  from: number,
  to: number,
  event: string,
  seal: string | null,
  say: string,
): Verdict => ({ act: "cut", from, to, event, seal, say });

const unowned = (a: Addressed, onePaint: (say: string) => Verdict, side: string): Verdict =>
  a.kind === "none"
    ? { act: "nothing", say: `nothing is painted ${side} the caret` }
    : onePaint(
        a.kind === "break"
          ? `join: the break ${side} belongs to no owned set`
          : "delete one character",
      );

type CellSay = "immortal" | "empty" | "sealed" | "no-merge" | "ordinary";

interface CellRule {
  readonly name: CellSay;
  readonly when: (t: ResolvedOwnedTarget) => boolean;
  readonly say: (t: ResolvedOwnedTarget) => Verdict | null;
}

const CELL_RULES: readonly CellRule[] = [
  {
    name: "immortal",
    when: (t) => t.mutability === "immortal",
    say: (t) => ({
      act: "consume",
      say: `cell immortal — the ${t.set} cannot be taken; the caret moves past it`,
    }),
  },
  {
    name: "empty",
    when: (t) => t.empty,
    say: (t) =>
      cutTo(
        t.wholeSpan.from,
        t.wholeSpan.to,
        "delete.usfm.unmakeEmptyParagraph",
        "unmake-empty-paragraph",
        `cell empty — consume the empty ${t.set}, the inverse of the Enter that made it`,
      ),
  },
  {
    name: "sealed",
    when: (t) => t.mutability === "trusted-only" || t.policy === "REFUSE",
    say: (t) => ({ act: "nothing", say: `cell sealed — the ${t.set}'s cell refuses the keyboard` }),
  },
  {
    name: "no-merge",
    when: (t) => t.paintsOwnLine && t.mergeTargetPolicy === "REFUSE",
    say: (t) => ({
      act: "nothing",
      say: `cell no-merge — the set above the ${t.set} refuses the join`,
    }),
  },
  { name: "ordinary", when: () => true, say: () => null },
];

const cellRuleFor = (t: ResolvedOwnedTarget): CellRule => {
  for (const rule of CELL_RULES) if (rule.when(t)) return rule;
  return CELL_RULES[CELL_RULES.length - 1];
};

const cellSay = (t: ResolvedOwnedTarget): CellSay => cellRuleFor(t).name;

const cellVerdict = (t: ResolvedOwnedTarget): Verdict | null => cellRuleFor(t).say(t);

export function backspaceAt(ix: OwnedIndex, pos: number): Verdict {
  const a = ix.addressedBackward(pos);
  const t = a.target;
  const onePaint = (say: string): Verdict =>
    a.at < pos || a.kind !== "glyph"
      ? cutTo(a.at - 1, a.at, a.kind === "break" ? "delete.usfm.join" : "delete", null, say)
      : { act: "default", say };
  if (!t) return unowned(a, onePaint, "behind");
  const cell = cellVerdict(t);
  if (cell) return cell;
  const whole = (event: string, seal: string, say: string): Verdict =>
    cutTo(t.wholeSpan.from, t.wholeSpan.to, event, seal, say);
  if (t.typable && pos >= t.typable.to)
    return cutTo(
      t.typable.to - 1,
      t.typable.to,
      "delete.usfm.number",
      null,
      `shorten the ${t.set}'s number rather than take it whole`,
    );
  if (t.typable && pos > t.typable.from) return onePaint(`delete one glyph inside the ${t.set}`);
  if (t.form === "box")
    return whole("delete.usfm.anchored", "anchored-box", `take the ${t.set} the box stands for`);
  if (t.policy === "DISSOLVE")
    return t.scope && t.scope.from === a.at - 1 && t.scope.to === a.at
      ? whole(
          "delete.usfm.wrapper",
          "dissolve-wrapper",
          `dissolve the ${t.set}: its last glyph goes with it`,
        )
      : onePaint(`delete one glyph inside the ${t.set}`);
  if (
    t.mutability === "direct" &&
    (t.anchor.from !== t.wholeSpan.from || t.anchor.to !== t.wholeSpan.to)
  )
    return onePaint(`delete one glyph inside the ${t.set}`);
  return whole("delete.usfm.owned", "own-whole", `take own(${t.set}) whole`);
}

export function deleteAt(ix: OwnedIndex, pos: number): Verdict {
  const a = ix.addressedForward(pos);
  const t = a.target;
  const onePaint = (say: string): Verdict =>
    a.at > pos || a.kind !== "glyph"
      ? cutTo(a.at, a.at + 1, a.kind === "break" ? "delete.usfm.join" : "delete", null, say)
      : { act: "default", say };
  if (!t) return unowned(a, onePaint, "ahead");
  const cell = cellVerdict(t);
  if (cell) return cell;
  const whole = (event: string, seal: string, say: string): Verdict =>
    cutTo(t.wholeSpan.from, t.wholeSpan.to, event, seal, say);
  const digits = t.typable && pos >= t.wholeSpan.from ? t.typable : null;
  if (digits && pos <= digits.from)
    return cutTo(
      digits.from,
      digits.from + 1,
      "delete.usfm.number",
      null,
      `shorten the ${t.set}'s number rather than take it whole`,
    );
  if (digits && pos < digits.to) return onePaint(`delete one glyph inside the ${t.set}`);
  if (t.form === "box")
    return whole("delete.usfm.anchored", "anchored-box", `take the ${t.set} the box stands for`);
  if (t.policy === "DISSOLVE")
    return t.scope && t.scope.from === a.at && t.scope.to === a.at + 1
      ? whole(
          "delete.usfm.wrapper",
          "dissolve-wrapper",
          `dissolve the ${t.set}: its last glyph goes with it`,
        )
      : onePaint(`delete one glyph inside the ${t.set}`);
  if (
    t.mutability === "direct" &&
    (t.anchor.from !== t.wholeSpan.from || t.anchor.to !== t.wholeSpan.to)
  )
    return onePaint(`delete one glyph inside the ${t.set}`);
  return whole("delete.usfm.owned", "own-whole", `take own(${t.set}) whole`);
}

function commit(
  state: EditorState,
  s: DocStructure,
  ix: OwnedIndex,
  r: PaintPort,
  at: number,
  back: boolean,
  v: Verdict,
  raw: (tr: Transaction) => void,
): boolean {
  note(state, {
    rule: back ? "guardedBackspace" : "guardedDelete",
    verdict: TRACED[v.act],
    detail: v.say,
  });
  const dispatch = immortalGuard(state, s, ix, r, at, back, raw);
  if (v.act === "nothing") return true;
  if (v.act === "consume") return consumePress(state, s, r, at, back, dispatch);
  if (v.act === "default") return false;
  dispatch(
    state.update({
      changes: { from: v.from, to: v.to, insert: weld(s, state, v.from, v.to) },
      selection: { anchor: back ? v.from + Math.max(0, at - v.to) : Math.min(at, v.from) },
      userEvent: v.event,
      ...(v.seal === null ? {} : { annotations: trusted.of(v.seal) }),
      scrollIntoView: true,
    }),
  );
  return true;
}

export function guardedBackspace(
  structureAt: GetStructure,
  plansAt: GetPlan,
  r: PaintPort = NO_PAINT,
): StateCommand {
  return ({ state, dispatch: raw }) => {
    const sel = state.selection.main;
    if (!sel.empty || !isVisual(state)) return false;
    const ix = plansAt(state).targets();
    return commit(state, structureAt(state), ix, r, sel.from, true, backspaceAt(ix, sel.from), raw);
  };
}

export function guardedDelete(
  structureAt: GetStructure,
  plansAt: GetPlan,
  r: PaintPort = NO_PAINT,
): StateCommand {
  return ({ state, dispatch: raw }) => {
    const sel = state.selection.main;
    if (!sel.empty || !isVisual(state)) return false;
    const ix = plansAt(state).targets();
    return commit(state, structureAt(state), ix, r, sel.from, false, deleteAt(ix, sel.from), raw);
  };
}

export function mergeParagraphBackwards(structureAt: GetStructure): StateCommand {
  return ({ state, dispatch }) => {
    const s = structureAt(state);
    const sel = state.selection.main;
    if (!sel.empty) return false;
    const l = lineAt(s, state, sel.from);
    if (!l || !opensAParagraph(l) || sel.from !== l.contentFrom || l.n <= 1) return false;
    let prev = l.n - 1;
    while (prev >= 1 && isBlankLine(s.lines.at(prev - 1))) prev--;
    if (prev < 1) return false;
    const from = s.lines.toAt(prev - 1);
    dispatch(
      state.update({
        changes: { from, to: l.contentFrom },
        selection: { anchor: from },
        userEvent: "delete.usfm.paragraph",
        scrollIntoView: true,
      }),
    );
    return true;
  };
}

export interface RangePlan {
  readonly lo: number;
  readonly hi: number;
  readonly keep: readonly PlanSpan[];
  readonly refused: boolean;
  readonly delimiterGone: boolean;
  readonly around: number;
}

function rangePlan(ix: OwnedIndex, s: DocStructure, from: number, to: number): RangePlan {
  let lo = from;
  let hi = to;
  let refused = false;
  const settled = new Set<number>();
  const forced = new Set<number>();
  const seenBreak = new Set<number>();
  const pending = new Map<number, ResolvedOwnedTarget>();
  for (const h of ix.targetsIn(from, to).hits) pending.set(h.target.id, h.target);
  const consented = (t: ResolvedOwnedTarget) => from <= t.wholeSpan.from && to >= t.wholeSpan.to;
  const overlaps = (sp: PlanSpan) => sp.to > lo && sp.from < hi;
  const straddled = (sp: PlanSpan) => overlaps(sp) && (sp.from < lo || sp.to > hi);
  const wholeOrNothing = (t: ResolvedOwnedTarget): boolean => {
    if (t.typable && t.typable.from <= lo && t.typable.to >= hi) return false;
    if (t.hiddenSpans.some(overlaps)) return true;
    if (t.paint === "point") return t.paintedSpans.some(straddled);
    if (t.paint === "boundary") return t.paintedSpans.some(overlaps);
    if (t.paint !== "ambient" || !t.scope) return true;
    const inside = t.scope.from <= lo && t.scope.to >= hi;
    return !inside || (t.policy === "DISSOLVE" && lo <= t.scope.from && hi >= t.scope.to);
  };
  const ownersOfBreaks = (): void => {
    const first = lineIndexAt(s, lo);
    const last = lineIndexAt(s, Math.max(lo, hi - 1));
    for (let i = Math.max(0, first); first >= 0 && i <= last && i < s.lines.length; i++) {
      const k = s.lines.toAt(i);
      if (k < lo || k >= hi || seenBreak.has(k)) continue;
      seenBreak.add(k);
      const t = ix.addressedForward(k).target;
      if (!t || settled.has(t.id)) continue;
      pending.set(t.id, t);
      forced.add(t.id);
    }
  };
  for (let round = 0; round < 8; round++) {
    let grew = false;
    ownersOfBreaks();
    for (const t of pending.values()) {
      if (settled.has(t.id) || !(forced.has(t.id) || overlaps(t.wholeSpan))) continue;
      const say = cellSay(t);
      const take = say !== "immortal" && !consented(t) && say !== "sealed";
      if (take && say !== "empty" && !forced.has(t.id) && !wholeOrNothing(t)) continue;
      settled.add(t.id);
      if (!take) {
        refused ||= say === "sealed" && !consented(t);
        continue;
      }
      grew ||= t.wholeSpan.from < lo || t.wholeSpan.to > hi;
      lo = Math.min(lo, t.wholeSpan.from);
      hi = Math.max(hi, t.wholeSpan.to);
    }
    if (!grew) break;
  }
  const keep: PlanSpan[] = [];
  let around = 0;
  for (const h of ix.targetsIn(lo, hi + 1).hits) {
    const t = h.target;
    if (t.mutability !== "immortal" || consented(t)) continue;
    const a = anchoredBack(s, t.wholeSpan);
    const clipped = { from: Math.max(a.from, lo), to: Math.min(a.to, hi) };
    if (clipped.to <= clipped.from) continue;
    keep.push(clipped);
    around += 1;
  }
  keep.sort((x, y) => x.from - y.from);
  let delimiterGone = false;
  for (const t of pending.values())
    if (t.delimiter && lo <= t.delimiter.from && hi >= t.delimiter.to) delimiterGone = true;
  return { lo, hi, keep, refused, delimiterGone, around };
}

const gapsAround = (lo: number, hi: number, keep: readonly PlanSpan[]) => {
  const out: { from: number; to: number }[] = [];
  let at = lo;
  for (const sp of keep) {
    if (sp.from > at) out.push({ from: at, to: sp.from });
    at = Math.max(at, sp.to);
  }
  if (hi > at) out.push({ from: at, to: hi });
  return out;
};

export type RangeAct =
  | { readonly act: "pass"; readonly say: string }
  | { readonly act: "refuse"; readonly say: string }
  | {
      readonly act: "writeAround";
      readonly gaps: readonly { from: number; to: number }[];
      readonly around: number;
      readonly say: string;
    }
  | {
      readonly act: "rewrite";
      readonly from: number;
      readonly to: number;
      readonly insert: string;
      readonly event: string;
      readonly caret: number;
      readonly say: string;
    };

const RANGE_TRACED: Record<RangeAct["act"], TraceVerdict> = {
  pass: "passed",
  refuse: "refused",
  writeAround: "rewrote",
  rewrite: "rewrote",
};

export function rangeVerdict(
  plan: RangePlan,
  asked: { from: number; to: number },
  pasted: string | null,
  joinText: string,
): RangeAct {
  const { lo, hi } = plan;
  if (plan.refused)
    return { act: "refuse", say: "the range takes part of a set whose cell refuses the keyboard" };
  if (plan.keep.length) {
    const gaps = gapsAround(lo, hi, plan.keep);
    if (!gaps.length) return { act: "refuse", say: "nothing survives the write-around" };
    return {
      act: "writeAround",
      gaps,
      around: plan.around,
      say: `wrote around ${plan.around} immortal set(s)`,
    };
  }
  const insert = pasted !== null ? pasted : joinText;
  if (lo === asked.from && hi === asked.to && (!insert || pasted !== null))
    return { act: "pass", say: "the asked range is exactly what goes" };
  return {
    act: "rewrite",
    from: lo,
    to: hi,
    insert,
    event: pasted !== null ? "input.paste.usfm.range" : "delete.usfm.range",
    caret: lo + (pasted?.length ?? 0),
    say: `widened [${asked.from},${asked.to}) to [${lo},${hi}) and welded ${JSON.stringify(insert)}`,
  };
}

export function deleteMarkersWholeOrNotAtAll(
  structureAt: GetStructure,
  plansAt: GetPlan,
): TransactionRule {
  return (tr) => {
    if (!tr.docChanged || !isUserReplacement(tr)) return tr;
    if (!isVisual(tr.startState) || isTrusted(tr)) return tr;
    let from = Infinity;
    let to = -1;
    const insTexts: string[] = [];
    let ranges = 0;
    tr.changes.iterChanges((fA, tA, _fB, _tB, ins) => {
      if (tA <= fA) return;
      ranges += 1;
      if (ins.length) insTexts.push(ins.toString());
      from = Math.min(from, fA);
      to = Math.max(to, tA);
    });
    if (to < 0) return tr;
    const pasted = insTexts.length ? insTexts[insTexts.length - 1] : null;
    if (pasted !== null && ranges > 1) return tr;
    const rule = "deleteMarkersWholeOrNotAtAll";
    const s = structureAt(tr.startState);
    const plan = rangePlan(plansAt(tr.startState).targets(), s, from, to);
    const welded = weld(s, tr.startState, plan.lo, plan.hi);
    const joinText = welded || (plan.delimiterGone ? spaceBefore(tr.startState, plan.hi) : "");
    const v = rangeVerdict(plan, { from, to }, pasted, joinText);
    noteTr(tr, { rule, verdict: RANGE_TRACED[v.act], detail: v.say });
    if (v.act === "pass") return tr;
    if (v.act === "refuse") return [];
    if (v.act === "writeAround") {
      const out: { from: number; to: number; insert?: string }[] = v.gaps.map((c, i) =>
        i === 0 && pasted !== null ? { ...c, insert: pasted } : c,
      );
      return {
        changes: out,
        selection: { anchor: out[0].from + (pasted?.length ?? 0) },
        userEvent: "delete.usfm.aroundImmortal",
      };
    }
    return {
      changes: { from: v.from, to: v.to, insert: v.insert },
      selection: { anchor: v.caret },
      userEvent: v.event,
    };
  };
}

export const isUserReplacement = (tr: Transaction) =>
  tr.isUserEvent("delete") ||
  tr.isUserEvent("input.type") ||
  tr.isUserEvent("input.paste") ||
  tr.isUserEvent("input.drop");
