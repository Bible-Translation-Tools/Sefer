/**
 * Owned targets: the per-line index of things that belong to the markup rather
 * than to the prose — a marker, a delimiter, a hidden box, a join.
 *
 * Everything a deletion or a caret move needs to know about a position comes
 * from here: `addressedBackward`/`addressedForward` say what a key press would
 * be addressing, and `targetsIn` says what a range would take. Built lazily per
 * line (and memoized per row), because a keystroke touches three lines and a
 * book has thousands.
 */

import { NOTE_PART } from "#core/galley";

import { lineIndexAt, type DocStructure } from "./docStructure";
import { paintOver, type PaintIndex } from "./paint";
import type { DocPlan, PlanSpan, ResolvedNote, ResolvedSlot, ResolvedWord } from "./plan";
import {
  type Assignment,
  type ClassKey,
  type Mutability,
  type OwnedSetName,
  type OwnershipBit,
  type PaintReach,
  CLASS_KEYS,
  ownershipOf,
  paintsItsOwnLineAmbient,
  setsPaintedBy,
} from "./registry";
import { armed, span } from "./timing";

type OwnedSetId = number & { readonly __brand: "OwnedSetId" };

export type Direction = "backward" | "forward";

export type PaintKind = "glyph" | "break" | "box" | "none";

export interface Addressed {
  readonly target: ResolvedOwnedTarget | null;
  readonly kind: PaintKind;
  readonly at: number;
}

interface TargetFacts {
  readonly id: OwnedSetId;
  readonly set: OwnedSetName;
  readonly cls: ClassKey;
  readonly anchor: PlanSpan;
  readonly wholeSpan: PlanSpan;
  readonly paintedSpans: readonly PlanSpan[];
  readonly hiddenSpans: readonly PlanSpan[];
  readonly scope: PlanSpan | null;
  readonly paint: PaintReach;
  readonly mutability: Mutability;
  readonly policy: OwnershipBit | null;
  readonly paintsOwnLine: boolean;
  readonly empty: boolean;
  readonly mergeTargetPolicy: OwnershipBit | null;
  readonly typable: PlanSpan | null;
  readonly delimiter: PlanSpan | null;
}

export type ResolvedOwnedTarget =
  | (TargetFacts & { readonly form: "spans" })
  | (TargetFacts & { readonly form: "box"; readonly box: number })
  | (TargetFacts & { readonly form: "ambient" })
  | (TargetFacts & { readonly form: "elided" });

export interface OwnedHit {
  readonly target: ResolvedOwnedTarget;
  readonly whole: boolean;
}

export interface OwnedRangeAnswer {
  readonly from: number;
  readonly to: number;
  readonly widened: PlanSpan;
  readonly hits: readonly OwnedHit[];
}

export interface OwnedIndex {
  readonly all: readonly ResolvedOwnedTarget[];
  addressedBackward(pos: number): Addressed;
  addressedForward(pos: number): Addressed;
  targetAt(pos: number, direction: Direction): ResolvedOwnedTarget | null;
  targetsIn(from: number, to: number): OwnedRangeAnswer;
}

const NONE: readonly PlanSpan[] = [];

const NO_TARGETS: readonly ResolvedOwnedTarget[] = [];

const complement = (whole: PlanSpan, holes: readonly PlanSpan[]): PlanSpan[] => {
  const out: PlanSpan[] = [];
  let at = whole.from;
  for (const h of holes) {
    if (h.from > at) out.push({ from: at, to: h.from });
    if (h.to > at) at = h.to;
  }
  if (whole.to > at) out.push({ from: at, to: whole.to });
  return out;
};

const SET_OF_CLASS: ReadonlyMap<ClassKey, OwnedSetName> = new Map(
  CLASS_KEYS.flatMap((cls) => {
    const named = setsPaintedBy(cls);
    // SAFETY: `named.length` is checked, so `named[0]` is present; the
    // assertion only fixes the tuple shape `new Map` wants.
    return named.length ? [[cls, named[0]] as [ClassKey, OwnedSetName]] : [];
  }),
);

const byWholeSpan = (x: ResolvedOwnedTarget, y: ResolvedOwnedTarget): number =>
  x.wholeSpan.from - y.wholeSpan.from || x.wholeSpan.to - y.wholeSpan.to;

export function buildOwnedIndex(s: DocStructure, plan: DocPlan, a: Assignment): OwnedIndex {
  const rows = a.rows;
  const paint: PaintIndex = paintOver(s, plan);
  const docLen = plan.docLen;
  const lines = s.lines;
  const blocks = s.blocks;
  const verses = s.verses;
  let nextId = 0;

  interface Extra {
    box?: number;
    scope?: PlanSpan | null;
    empty?: boolean;
    mergeTargetPolicy?: OwnershipBit | null;
    typable?: PlanSpan | null;
    delimiter?: PlanSpan | null;
  }

  const make = (
    out: ResolvedOwnedTarget[],
    cls: ClassKey,
    anchor: PlanSpan,
    wholeSpan: PlanSpan,
    paintedSpans: readonly PlanSpan[],
    hiddenSpans: readonly PlanSpan[],
    extra: Extra = {},
  ): void => {
    const set = SET_OF_CLASS.get(cls);
    if (!set) return;
    const row = rows[cls];
    const facts: TargetFacts = {
      // SAFETY: `OwnedSetId` is a branded number; this counter is the only
      // thing that mints one, which is what the brand exists to say.
      id: nextId++ as OwnedSetId,
      set,
      cls,
      anchor,
      wholeSpan,
      paintedSpans: paintedSpans.length ? paintedSpans : NONE,
      hiddenSpans: hiddenSpans.length ? hiddenSpans : NONE,
      scope: extra.scope ?? null,
      paint: row.cell.paint,
      mutability: row.cell.mutability,
      policy: ownershipOf(row) ?? null,
      paintsOwnLine: paintsItsOwnLineAmbient(cls),
      empty: extra.empty === true,
      mergeTargetPolicy: extra.mergeTargetPolicy ?? null,
      typable: extra.typable ?? null,
      delimiter: extra.delimiter ?? null,
    };
    if (paintedSpans.length) out.push({ ...facts, form: "spans" });
    else if (extra.box !== undefined) out.push({ ...facts, form: "box", box: extra.box });
    else if (facts.paint === "none") out.push({ ...facts, form: "elided" });
    else out.push({ ...facts, form: "ambient" });
  };

  const slotTarget = (out: ResolvedOwnedTarget[], cls: ClassKey, r: ResolvedSlot): void => {
    const whole = { from: r.from, to: r.to };
    if (r.form === "elided") {
      make(out, cls, whole, whole, NONE, [whole]);
      return;
    }
    if (r.form === "pip") {
      make(out, cls, whole, whole, [whole], NONE);
      return;
    }
    if (r.form === "box") {
      const at = r.box ?? r.to;
      make(out, cls, { from: at, to: at }, whole, NONE, r.hidden, { box: at });
      return;
    }
    const digits = r.digits ?? whole;
    const hidden = r.delimiter ? [...r.hidden, r.delimiter] : r.hidden;
    make(out, cls, digits, whole, [digits], hidden, {
      typable: rows[cls].typable === true && r.digits ? r.digits : null,
      delimiter: r.delimiter,
    });
  };

  const noteTarget = (out: ResolvedOwnedTarget[], r: ResolvedNote): void => {
    const whole = { from: r.from, to: r.to };
    const caller = r.parts.find((p) => p.kind === NOTE_PART.CALLER);
    const anchor = caller ? { from: caller.from, to: caller.to } : whole;
    if (r.form === "collapsed")
      make(out, "note.caller", anchor, whole, r.point ? [r.point] : NONE, NONE);
    else if (r.form === "elided") make(out, "note.caller", anchor, whole, NONE, r.hidden);
    else make(out, "note.caller", anchor, whole, complement(whole, r.hidden), r.hidden);
  };

  const wordTarget = (out: ResolvedOwnedTarget[], r: ResolvedWord): void => {
    const whole = { from: r.from, to: r.to };
    if (rows.char.cell.paint === "none") {
      make(out, "char", whole, whole, NONE, [whole]);
      return;
    }
    const scope = r.scope;
    if (!scope) {
      make(out, "char", whole, whole, [whole], NONE);
      return;
    }
    if (scope.to > scope.from) make(out, "char", scope, whole, [scope], r.hidden, { scope });
    else make(out, "char", scope, whole, NONE, r.hidden, { scope, box: scope.from });
  };

  const blockTarget = (out: ResolvedOwnedTarget[], j: number, head: number): void => {
    const from = blocks.fromAt(j);
    const contentFrom = blocks.contentFromAt(j);
    if (contentFrom <= from) return;
    const rb = plan.block(j);
    const cls = blocks.clsAt(j);
    const chrome = { from, to: contentFrom };
    const scope = { from, to: blocks.toAt(j) };
    const headTo = lines.toAt(head);
    const empty = contentFrom >= headTo;
    const soleLine = contentFrom >= scope.to;
    const behindBreak = from - 1;
    const holder =
      j > 0 && blocks.fromAt(j - 1) <= behindBreak && blocks.toAt(j - 1) >= behindBreak
        ? blocks.clsAt(j - 1)
        : null;
    const above = rb.startsLine
      ? head >= 1
        ? (holder ?? lines.maybe(head - 1)?.cls ?? null)
        : null
      : (holder ?? lines.maybe(head)?.cls ?? null);
    const mergeTargetPolicy = above ? (ownershipOf(rows[above]) ?? null) : null;
    const takesItsBreak = rb.startsLine && from > 0;
    const whole = takesItsBreak
      ? { from: from - 1, to: contentFrom }
      : soleLine
        ? { from, to: Math.min(scope.to + 1, docLen) }
        : { from, to: contentFrom };
    const drawn = rb.breakAt === null ? {} : { box: rb.breakAt };
    if (!rb.paints) {
      make(out, cls, chrome, whole, NONE, [whole], { empty, scope, mergeTargetPolicy });
      return;
    }
    if (empty) {
      const edges: PlanSpan[] = [];
      if (takesItsBreak) edges.push({ from: from - 1, to: from });
      const below = Math.min(headTo + 1, docLen);
      const swallowed = rb.reflow.some(
        (r) => r.kind === "hide" && r.from <= contentFrom && r.to >= below,
      );
      if ((takesItsBreak || soleLine) && below > contentFrom && !swallowed)
        edges.push({ from: contentFrom, to: below });
      make(out, cls, chrome, whole, edges, [chrome], {
        empty,
        scope,
        mergeTargetPolicy,
        ...drawn,
      });
      return;
    }
    if (takesItsBreak) {
      make(out, cls, chrome, whole, [{ from: from - 1, to: from }], [chrome], {
        scope,
        mergeTargetPolicy,
      });
      return;
    }
    make(out, cls, chrome, whole, NONE, [chrome], { scope, mergeTargetPolicy, ...drawn });
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

  const firstBlockFrom = (pos: number): number => {
    let lo = 0;
    let hi = blocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (blocks.fromAt(mid) < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const resolveRow = (i: number): readonly ResolvedOwnedTarget[] => {
    const l = lines.at(i);
    const rl = plan.line(i + 1);
    const out: ResolvedOwnedTarget[] = [];
    for (let k = firstVerseFrom(l.from); k < verses.length && verses[k].markerFrom <= l.to; k++)
      slotTarget(out, "slot.v", plan.verse(k));
    if (rl.slot) slotTarget(out, "slot.c", rl.slot);
    const c = rl.chunk;
    if (c) {
      const head = { from: c.from, to: c.to };
      const whole = { from: c.from, to: Math.min(l.to + 1, docLen) };
      if (c.form === "point") make(out, "chunk", head, whole, [head], NONE);
      else make(out, "chunk", head, whole, NONE, [whole]);
    }
    for (const m of rl.marks) {
      const span = { from: m.from, to: m.to };
      const cls: ClassKey = m.kind === "milestone" ? "milestone" : "optbreak";
      if (m.form === "point") make(out, cls, span, span, [span], NONE);
      else make(out, cls, span, span, NONE, [span]);
    }
    for (const n of l.notes) {
      const r = plan.noteAt.get(n.from);
      if (r) noteTarget(out, r);
    }
    for (const w of l.words) {
      const r = plan.wordAt.get(w.from);
      if (r) wordTarget(out, r);
    }
    for (let j = firstBlockFrom(l.from); j < blocks.length && blocks.fromAt(j) <= l.to; j++)
      blockTarget(out, j, i);
    return out.length ? out : NO_TARGETS;
  };

  const rowMemo: (readonly ResolvedOwnedTarget[] | undefined)[] = Array.from(
    { length: lines.length },
    () => undefined,
  );
  const rowAt = (i: number): readonly ResolvedOwnedTarget[] => {
    const held = rowMemo[i];
    if (held) return held;
    if (!armed()) return (rowMemo[i] = resolveRow(i));
    const done = span("index", "row");
    try {
      return (rowMemo[i] = resolveRow(i));
    } finally {
      done();
    }
  };

  const straddleOver = (list: readonly PlanSpan[]) => {
    let widest = -1;
    return (from: number, to: number, out: Set<number>): void => {
      if (!list.length) return;
      if (widest < 0) for (const r of list) if (r.to - r.from > widest) widest = r.to - r.from;
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].from < to) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo - 1; k >= 0 && list[k].from + widest >= from; k--)
        if (list[k].to > from) out.add(lineIndexAt(s, list[k].from));
    };
  };

  const straddlingNotes = straddleOver(s.notes);
  const straddlingWords = straddleOver(s.words);

  const nearMemo: (readonly ResolvedOwnedTarget[] | undefined)[] = Array.from(
    { length: lines.length },
    () => undefined,
  );
  const nearAt = (i: number): readonly ResolvedOwnedTarget[] => {
    const held = nearMemo[i];
    if (held) return held;
    const reaching = new Set<number>();
    straddlingNotes(lines.fromAt(i), lines.toAt(i) + 1, reaching);
    straddlingWords(lines.fromAt(i), lines.toAt(i) + 1, reaching);
    for (let j = i - 1; j <= i + 1; j++) reaching.delete(j);
    const here = rowAt(i);
    const before = i > 0 ? rowAt(i - 1) : NO_TARGETS;
    const after = i + 1 < lines.length ? rowAt(i + 1) : NO_TARGETS;
    const made =
      reaching.size || before.length || after.length
        ? [
            ...[...reaching].sort((x, y) => x - y).flatMap((j) => [...rowAt(j)]),
            ...before,
            ...here,
            ...after,
          ]
        : here;
    nearMemo[i] = made;
    return made;
  };

  const localAt = (pos: number): readonly ResolvedOwnedTarget[] => {
    const i = lineIndexAt(s, pos);
    return i < 0 ? NO_TARGETS : nearAt(i);
  };

  const ofPainted = (byte: number): ResolvedOwnedTarget | null => {
    let best: ResolvedOwnedTarget | null = null;
    let rank = -1;
    let width = Infinity;
    let edge = -1;
    for (const t of localAt(byte)) {
      const here = t.empty ? 1 : 0;
      if (here < rank) continue;
      for (const sp of t.paintedSpans) {
        if (sp.from > byte || sp.to <= byte) continue;
        const w = sp.to - sp.from;
        if (here === rank && (w > width || (w === width && sp.from < edge))) continue;
        best = t;
        rank = here;
        width = w;
        edge = sp.from;
      }
    }
    return best;
  };

  const ofWhole = (byte: number): ResolvedOwnedTarget | null => {
    let best: ResolvedOwnedTarget | null = null;
    let width = Infinity;
    let edge = -1;
    for (const t of localAt(byte)) {
      const sp = t.wholeSpan;
      if (sp.from > byte || sp.to <= byte) continue;
      const w = sp.to - sp.from;
      if (w > width || (w === width && sp.from < edge)) continue;
      best = t;
      width = w;
      edge = sp.from;
    }
    return best;
  };

  const ofBox = (pos: number, atCaret = false): ResolvedOwnedTarget | null => {
    let best: ResolvedOwnedTarget | null = null;
    for (const t of localAt(pos))
      if (t.form === "box" && t.box === pos && (best === null || byWholeSpan(t, best) < 0))
        best = t;
    if (best === null) return null;
    return !atCaret || best.anchor.from === best.anchor.to ? best : null;
  };

  const hides = (byte: number): boolean => {
    for (const t of localAt(byte))
      for (const sp of t.hiddenSpans) if (sp.from <= byte && sp.to > byte) return true;
    return false;
  };

  const paints = (byte: number): boolean => !paint.hidden(byte, byte + 1) && !hides(byte);

  const endsALine = (byte: number): boolean => {
    const i = lineIndexAt(s, byte);
    return i >= 0 && lines.toAt(i) === byte;
  };

  const startsALine = (pos: number): boolean => {
    const i = lineIndexAt(s, pos);
    return i >= 0 && lines.fromAt(i) === pos;
  };

  const ofHead = (head: number, pos: number): ResolvedOwnedTarget | null => {
    const t = ofWhole(head);
    return t && pos > t.wholeSpan.from && pos <= t.wholeSpan.to ? t : null;
  };

  const ofHeadAhead = (from: number): ResolvedOwnedTarget | null => {
    const t = ofWhole(from);
    return t && t.wholeSpan.from >= from - 1 ? t : null;
  };

  const ofEdge = (pos: number): ResolvedOwnedTarget | null => {
    const t = ofWhole(0);
    return t && t.anchor.to === pos ? t : null;
  };

  const backward = (pos: number): Addressed => {
    const held = paint.draws(pos) ? ofBox(pos, true) : null;
    let p = pos;
    let behind: ResolvedOwnedTarget | null = null;
    let kind: PaintKind = "none";
    let at = p;
    for (let guard = 0; guard < 512 && p > 0; guard++) {
      if (p < pos && paint.draws(p)) {
        behind = ofBox(p);
        kind = "box";
        at = p;
        break;
      }
      if (paints(p - 1)) {
        const brk = endsALine(p - 1);
        behind =
          ofPainted(p - 1) ??
          (brk && !paint.joined(p - 1) && startsALine(p)
            ? (ofWhole(p - 1) ?? ofHead(p, pos))
            : null);
        kind = brk ? "break" : "glyph";
        at = p;
        break;
      }
      p--;
    }
    if (held && !(kind === "break" && behind !== null))
      return { target: held, kind: "box", at: pos };
    if (kind === "none") return { target: ofEdge(pos), kind, at: p };
    return { target: behind, kind, at };
  };

  const forward = (pos: number): Addressed => {
    let p = pos;
    let ahead: ResolvedOwnedTarget | null = null;
    let kind: PaintKind = "none";
    let at = p;
    for (let guard = 0; guard < 512 && p < docLen; guard++) {
      if (p > pos && paint.draws(p)) {
        ahead = ofBox(p);
        kind = "box";
        at = p;
        break;
      }
      if (paints(p)) {
        const brk = endsALine(p);
        ahead =
          ofPainted(p) ??
          (brk && !paint.joined(p) && startsALine(p + 1)
            ? (ofWhole(p) ?? ofHeadAhead(p + 1))
            : null);
        kind = brk ? "break" : "glyph";
        at = p;
        break;
      }
      p++;
    }
    if (kind === "none") return { target: null, kind, at: p };
    return { target: ahead, kind, at };
  };

  let every: readonly ResolvedOwnedTarget[] | null = null;

  return {
    get all(): readonly ResolvedOwnedTarget[] {
      if (every) return every;
      const out: ResolvedOwnedTarget[] = [];
      for (let i = 0; i < lines.length; i++) for (const t of rowAt(i)) out.push(t);
      out.sort(byWholeSpan);
      every = out;
      return out;
    },
    addressedBackward: backward,
    addressedForward: forward,
    targetAt: (pos, direction) => (direction === "backward" ? backward(pos) : forward(pos)).target,
    targetsIn(from, to) {
      let lo = from;
      let hi = to;
      const found = new Map<OwnedSetId, ResolvedOwnedTarget>();
      for (let round = 0; round < 8; round++) {
        const before = found.size;
        const a = lineIndexAt(s, lo);
        const b = lineIndexAt(s, hi - 1);
        if (a >= 0)
          for (let i = Math.max(0, a); i <= Math.min(lines.length - 1, Math.max(a, b)); i++)
            for (const t of nearAt(i))
              if (t.wholeSpan.to > lo && t.wholeSpan.from < hi) found.set(t.id, t);
        if (found.size === before) break;
        for (const t of found.values()) {
          const w = t.wholeSpan;
          if (w.from < lo) lo = w.from;
          if (w.to > hi) hi = w.to;
        }
      }
      const hits: OwnedHit[] = [...found.values()].sort(byWholeSpan).map((t) => ({
        target: t,
        whole: from <= t.wholeSpan.from && to >= t.wholeSpan.to,
      }));
      return { from, to, widened: { from: lo, to: hi }, hits };
    },
  };
}
