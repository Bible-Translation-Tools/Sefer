/**
 * The resolved document plan: for each line, block and verse, what is actually
 * drawn and what may actually be edited, given the structure and the current
 * assignment.
 *
 * Lazy per row, memoized, and stamped with the structure's revision — a plan
 * over a stale fold is a bug that would otherwise show up as decorations in the
 * wrong place, so `planAt` asserts the revisions match. This is the layer
 * between "what the text is" (structure) and "what the reader sees" (paint,
 * decorations).
 */

import { NOTE_PART } from "../../core/galley";
import {
  isBlankLine,
  lineIndexAt,
  opensAParagraph,
  paintsItsOwnLine,
  type Block,
  type ChapterRow,
  type DocLine,
  type DocStructure,
  type NoteRange,
  type VerseRow,
  type WordRange,
} from "./docStructure";
import { buildOwnedIndex, type OwnedIndex } from "./owned";
import type { Assignment, ClassKey, Paint, Registry, WidgetKey } from "./registry";
import { armed, span } from "./timing";

export interface PlanSpan {
  from: number;
  to: number;
}

export type NoteForm = "collapsed" | "expanded" | "elided";

export type SlotForm = "digits" | "box" | "pip" | "elided";

export type MarkForm = "point" | "hidden";

export type ReflowKind = "hide" | "join" | "chunk-point" | "chunk-hidden";

export interface ResolvedNote {
  from: number;
  to: number;
  kind: string;
  form: NoteForm;
  mark: string;
  point: PlanSpan | null;
  hidden: readonly PlanSpan[];
  parts: NoteRange["parts"];
}

export interface ResolvedWord {
  from: number;
  to: number;
  scope: PlanSpan | null;
  hidden: readonly PlanSpan[];
}

export interface ResolvedSlot {
  readonly kind: "v" | "c";
  readonly from: number;
  readonly to: number;
  readonly form: SlotForm;
  readonly num: string | null;
  readonly residual: WidgetKey | null;
  readonly digits: PlanSpan | null;
  readonly delimiter: PlanSpan | null;
  readonly box: number | null;
  readonly hidden: readonly PlanSpan[];
}

export interface ResolvedMark {
  readonly from: number;
  readonly to: number;
  readonly kind: "milestone" | "optbreak";
  readonly name: string;
  readonly form: MarkForm;
}

export interface ResolvedChunk {
  readonly from: number;
  readonly to: number;
  readonly form: MarkForm;
}

export interface ResolvedLine {
  readonly hidden: readonly PlanSpan[];
  readonly paints: boolean;
  readonly slot: ResolvedSlot | null;
  readonly chunk: ResolvedChunk | null;
  readonly marks: readonly ResolvedMark[];
}

export interface ReflowSpan {
  readonly from: number;
  readonly to: number;
  readonly kind: ReflowKind;
}

export interface ResolvedBlock {
  readonly reflow: readonly ReflowSpan[];
  readonly joined: number;
  readonly paints: boolean;
  readonly startsLine: boolean;
  readonly headHidden: PlanSpan | null;
  readonly inblk: PlanSpan | null;
  readonly breakAt: number | null;
}

export interface ResolvedApparatus {
  at: number;
  chapter: ChapterRow;
  notes: readonly ResolvedNote[];
}

export interface DocPlan {
  readonly revision: number;
  readonly docLen: number;
  readonly joinWidget: WidgetKey | null;
  readonly notes: readonly ResolvedNote[];
  readonly noteAt: ReadonlyMap<number, ResolvedNote>;
  readonly words: readonly ResolvedWord[];
  readonly wordAt: ReadonlyMap<number, ResolvedWord>;
  readonly apparatus: readonly ResolvedApparatus[];
  readonly line: (n: number) => ResolvedLine;
  readonly block: (i: number) => ResolvedBlock;
  readonly verse: (k: number) => ResolvedSlot;
  readonly atomic: (l: DocLine) => readonly PlanSpan[];
  readonly targets: () => OwnedIndex;
}

export function callerMark(i: number): string {
  let s = "";
  i += 1;
  while (i > 0) {
    s = String.fromCharCode(97 + ((i - 1) % 26)) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

const NOTE_PART_CLASS = new Map<number, ClassKey>([
  [NOTE_PART.CALLER, "note.caller"],
  [NOTE_PART.ORIGIN, "note.body"],
  [NOTE_PART.BODY, "note.body"],
  [NOTE_PART.MARKUP, "note.markup"],
]);

const partClass = (kind: number): ClassKey => NOTE_PART_CLASS.get(kind) ?? "note.markup";

const NO_SPANS: readonly PlanSpan[] = [];
const NO_MARKS: readonly ResolvedMark[] = [];

class Spans {
  readonly out: PlanSpan[] = [];
  push(from: number, to: number): void {
    if (to <= from) return;
    const last = this.out[this.out.length - 1];
    if (last && from <= last.to) {
      if (to > last.to) last.to = to;
      return;
    }
    this.out.push({ from, to });
  }
}

function resolveNote(n: NoteRange, rows: Registry): ResolvedNote {
  const paint = (cls: ClassKey): Paint => rows[cls].cell.paint;
  const head = { from: n.from, to: n.to, kind: n.kind, parts: n.parts, mark: "" };
  if (paint("note.markup") === "none" && paint("note.body") === "none") {
    return paint("note.caller") === "none"
      ? { ...head, form: "elided", point: null, hidden: [{ from: n.from, to: n.to }] }
      : { ...head, form: "collapsed", point: { from: n.from, to: n.to }, hidden: [] };
  }
  const hidden = new Spans();
  const take = (from: number, to: number, cls: ClassKey) => {
    if (paint(cls) === "none") hidden.push(from, to);
  };
  let at = n.from;
  for (const p of n.parts) {
    if (p.from >= n.to) break;
    const to = Math.min(p.to, n.to);
    if (to <= at) continue;
    take(at, p.from, "note.markup");
    take(Math.max(at, p.from), to, partClass(p.kind));
    at = to;
  }
  take(at, n.to, "note.markup");
  return { ...head, form: "expanded", point: null, hidden: hidden.out };
}

function resolveWord(w: WordRange, rows: Registry, mask: (pos: number) => number): ResolvedWord {
  const paint = rows.char.cell.paint;
  const hidden = new Spans();
  if (paint !== "point") {
    hidden.push(mask(w.from), w.surfaceFrom);
    hidden.push(mask(w.attrFrom), w.attrTo);
    hidden.push(mask(w.attrTo), w.to);
  }
  return {
    from: w.from,
    to: w.to,
    scope: paint === "ambient" ? { from: w.surfaceFrom, to: w.surfaceTo } : null,
    hidden: hidden.out,
  };
}

class PlanLine implements ResolvedLine {
  readonly hidden: readonly PlanSpan[];
  readonly paints: boolean;
  readonly slot: ResolvedSlot | null;
  readonly chunk: ResolvedChunk | null;
  readonly #line: DocLine;
  readonly #milestone: MarkForm;
  readonly #optbreak: MarkForm;
  #marks: readonly ResolvedMark[] | null = null;

  constructor(
    line: DocLine,
    hidden: readonly PlanSpan[],
    paints: boolean,
    slot: ResolvedSlot | null,
    chunk: ResolvedChunk | null,
    milestone: MarkForm,
    optbreak: MarkForm,
  ) {
    this.#line = line;
    this.hidden = hidden;
    this.paints = paints;
    this.slot = slot;
    this.chunk = chunk;
    this.#milestone = milestone;
    this.#optbreak = optbreak;
  }

  get marks(): readonly ResolvedMark[] {
    if (this.#marks) return this.#marks;
    const l = this.#line;
    const out: ResolvedMark[] = [];
    for (const m of l.milestones)
      out.push({ from: m.from, to: m.to, kind: "milestone", name: m.name, form: this.#milestone });
    for (const b of l.breaks)
      out.push({ from: b.from, to: b.to, kind: "optbreak", name: "", form: this.#optbreak });
    this.#marks = out.length ? out : NO_MARKS;
    return this.#marks;
  }
}

function ownedIndexOf(s: DocStructure, plan: DocPlan, a: Assignment): OwnedIndex {
  if (!armed()) return buildOwnedIndex(s, plan, a);
  const done = span("index", "build");
  try {
    return buildOwnedIndex(s, plan, a);
  } finally {
    done();
  }
}

export function resolvePlan(s: DocStructure, a: Assignment): DocPlan {
  const rows = a.rows;
  const paint = (cls: ClassKey): Paint => rows[cls].cell.paint;
  const pipped = (cls: ClassKey): boolean => a.clamped.some((c) => c.cls === cls && c.to === "pip");

  const notes: ResolvedNote[] = [];
  const noteAt = new Map<number, ResolvedNote>();
  const atomicNotes: ResolvedNote[] = [];
  for (const n of s.notes) {
    const r = resolveNote(n, rows);
    notes.push(r);
    noteAt.set(r.from, r);
    if (r.form !== "expanded") atomicNotes.push(r);
  }

  const mask = (pos: number): number => {
    let at = pos;
    for (const n of atomicNotes) if (n.from <= at && n.to > at) at = Math.max(at, n.to);
    return at;
  };

  const words: ResolvedWord[] = [];
  const wordAt = new Map<number, ResolvedWord>();
  for (const w of s.words) {
    const r = resolveWord(w, rows, mask);
    words.push(r);
    wordAt.set(r.from, r);
  }

  const chapterOf = new Map<number, number>();
  s.chapters.forEach((ch, i) => {
    const last = Math.min(ch.lastLine, s.lines.length);
    if (ch.line > last) return;
    const lo = s.lines.fromAt(ch.line - 1);
    const hi = s.lines.toAt(last - 1);
    for (const note of s.notes) if (note.from >= lo && note.from <= hi) chapterOf.set(note.from, i);
  });
  const shown = new Map<number, ResolvedNote[]>();
  for (const r of notes) {
    if (r.form !== "collapsed") continue;
    const key = chapterOf.get(r.from) ?? -1;
    const list = shown.get(key) ?? [];
    r.mark = callerMark(list.length);
    list.push(r);
    shown.set(key, list);
  }
  const apparatus: ResolvedApparatus[] = [];
  s.chapters.forEach((ch, i) => {
    const list = shown.get(i);
    const lastLine = Math.min(ch.lastLine, s.lines.length);
    if (!list || !list.length || lastLine < 1) return;
    apparatus.push({ at: s.lines.toAt(lastLine - 1), chapter: ch, notes: list });
  });

  const chromeHidden = paint("chrome") === "none";
  const chunkForm: MarkForm = paint("chunk") === "point" ? "point" : "hidden";
  const milestoneForm: MarkForm = paint("milestone") === "point" ? "point" : "hidden";
  const optbreakForm: MarkForm = paint("optbreak") === "point" ? "point" : "hidden";
  const blankElided = paint("blank") === "none";
  const breaks = paint("newline.between") === "boundary";
  const joinWidget: WidgetKey | null =
    paint("newline.inside") === "point" ? (rows["newline.inside"].widget ?? null) : null;
  const joinKind: ReflowKind = joinWidget ? "join" : "hide";
  const pipV = pipped("slot.v");
  const pipC = pipped("slot.c");
  const docLen = s.analysis?.docLen ?? (s.lines.length ? s.lines.toAt(s.lines.length - 1) : 0);

  const slotOf = (
    kind: "v" | "c",
    from: number,
    markerEnd: number,
    numFrom: number,
    numTo: number,
    contentFrom: number,
    num: string | null,
  ): ResolvedSlot => {
    const cls: ClassKey = kind === "v" ? "slot.v" : "slot.c";
    const residual = rows[cls].residual ? (rows[cls].widget ?? null) : null;
    const head = { kind, from, to: contentFrom, num, residual };
    if (paint(cls) === "none")
      return {
        ...head,
        form: "elided",
        digits: null,
        delimiter: null,
        box: null,
        hidden: contentFrom > from ? [{ from, to: contentFrom }] : NO_SPANS,
      };
    if (residual && (kind === "v" ? pipV : pipC) && numTo > numFrom)
      return { ...head, form: "pip", digits: null, delimiter: null, box: null, hidden: NO_SPANS };
    if (numTo > numFrom)
      return {
        ...head,
        form: "digits",
        digits: { from: numFrom, to: numTo },
        delimiter: contentFrom > numTo ? { from: numTo, to: contentFrom } : null,
        box: null,
        hidden: chromeHidden && markerEnd > from ? [{ from, to: markerEnd }] : NO_SPANS,
      };
    const end = Math.min(markerEnd, contentFrom);
    return {
      ...head,
      form: "box",
      digits: null,
      delimiter: null,
      box: contentFrom,
      hidden: chromeHidden && end > from ? [{ from, to: end }] : NO_SPANS,
    };
  };

  const verses: (ResolvedSlot | null)[] = Array.from({ length: s.verses.length }, () => null);
  const verse = (k: number): ResolvedSlot => {
    let r = verses[k];
    if (!r) {
      const v: VerseRow = s.verses[k];
      r = slotOf("v", v.markerFrom, v.markerTo, v.numFrom, v.numTo, v.contentFrom, v.num);
      verses[k] = r;
    }
    return r;
  };

  const resolveLine = (l: DocLine): ResolvedLine => {
    let hidden: readonly PlanSpan[] = NO_SPANS;
    let paints = false;
    let slot: ResolvedSlot | null = null;
    let chunk: ResolvedChunk | null = null;
    if (paintsItsOwnLine(l)) {
      paints = paint(l.cls) !== "none";
      if (chromeHidden && l.contentFrom > l.from) hidden = [{ from: l.from, to: l.contentFrom }];
    } else if (l.cls === "chunk") {
      chunk = { from: l.from, to: l.contentFrom, form: chunkForm };
    } else if (l.cls === "slot.c") {
      slot = slotOf("c", l.from, l.markerEnd, l.numFrom, l.numTo, l.contentFrom, l.num);
      paints = slot.form !== "elided";
    }
    return new PlanLine(l, hidden, paints, slot, chunk, milestoneForm, optbreakForm);
  };

  const lines: (ResolvedLine | null)[] = Array.from({ length: s.lines.length }, () => null);
  const line = (n: number): ResolvedLine => {
    let r = lines[n - 1];
    if (!r) {
      r = resolveLine(s.lines.at(n - 1));
      lines[n - 1] = r;
    }
    return r;
  };

  const resolveBlock = (b: Block): ResolvedBlock => {
    const reflow: ReflowSpan[] = [];
    const push = (from: number, to: number, kind: ReflowKind) => {
      if (to > from) reflow.push({ from, to, kind });
    };
    const rows2 = b.lines;
    const holdsText = rows2.some((l) => !isBlankLine(l) && l.contentFrom < l.to);
    let prevEnd = -1;
    let sawText = false;
    let joined = 0;
    const swallow = (l: DocLine) => {
      push(prevEnd >= 0 ? prevEnd : l.from, Math.min(l.to + 1, docLen), "hide");
      prevEnd = -1;
    };
    for (const l of rows2) {
      if (opensAParagraph(l)) {
        if (l.contentFrom >= l.to) {
          if (breaks && (holdsText || (l.cls === "blank" && blankElided))) {
            swallow(l);
            continue;
          }
          if (chromeHidden) push(l.from, l.contentFrom, "hide");
          prevEnd = breaks ? l.to : -1;
          continue;
        }
        if (chromeHidden) push(l.from, l.contentFrom, "hide");
        sawText = true;
        prevEnd = breaks ? l.to : -1;
        continue;
      }
      if (isBlankLine(l)) {
        if (breaks) swallow(l);
        continue;
      }
      if (l.cls === "chunk") {
        const from = prevEnd >= 0 ? prevEnd : l.from;
        push(from, l.to, chunkForm === "point" && sawText ? "chunk-point" : "chunk-hidden");
        if (prevEnd >= 0) joined++;
        prevEnd = breaks ? l.to : -1;
        continue;
      }
      if (prevEnd >= 0) {
        push(prevEnd, l.from, joinKind);
        joined++;
      }
      prevEnd = breaks ? l.to : -1;
      sawText = true;
    }
    const at = lineIndexAt(s, b.from);
    const startsLine = at >= 0 && s.lines.fromAt(at) === b.from;
    const paints = paint(b.cls) !== "none";
    return {
      reflow,
      joined,
      paints,
      startsLine,
      headHidden:
        !startsLine && chromeHidden && b.contentFrom > b.from
          ? { from: b.from, to: b.contentFrom }
          : null,
      inblk: startsLine || !paints ? null : { from: b.from, to: b.to },
      breakAt: startsLine || !breaks ? null : b.from,
    };
  };

  const blocks: (ResolvedBlock | null)[] = Array.from({ length: s.blocks.length }, () => null);
  const block = (i: number): ResolvedBlock => {
    let r = blocks[i];
    if (!r) {
      r = resolveBlock(s.blocks.at(i));
      blocks[i] = r;
    }
    return r;
  };

  const atomic = (l: DocLine): readonly PlanSpan[] => {
    const out: PlanSpan[] = [];
    for (const m of line(l.n).marks) out.push({ from: m.from, to: m.to });
    for (const w of l.words) {
      const r = wordAt.get(w.from);
      if (r) for (const h of r.hidden) out.push({ from: h.from, to: h.to });
    }
    for (const n of l.notes) {
      const r = noteAt.get(n.from);
      if (!r) continue;
      if (r.point) out.push({ from: r.point.from, to: r.point.to });
      else for (const h of r.hidden) out.push({ from: h.from, to: h.to });
    }
    return out;
  };

  let targetIndex: OwnedIndex | null = null;
  const plan: DocPlan = {
    revision: s.revision,
    docLen,
    joinWidget,
    notes,
    noteAt,
    words,
    wordAt,
    apparatus,
    line,
    block,
    verse,
    atomic,
    targets: () => (targetIndex ??= ownedIndexOf(s, plan, a)),
  };
  return plan;
}
