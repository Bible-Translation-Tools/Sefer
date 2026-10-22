import { NOTE_PART } from "@sefer/text/engine/analysis";

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
import type { Assignment, ClassKey, PaintReach, Registry, WidgetKey } from "./registry";
import { isContainerClass } from "./registry";
import { armed, span } from "./timing";

export interface PlanSpan {
  from: number;
  to: number;
}

export type NoteForm = "collapsed" | "expanded" | "elided";

export type SlotForm = "digits" | "box" | "pip" | "elided";

export type MarkForm = "point" | "hidden";

export type ReflowKind = "hide" | "join";

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
  /** A figure's opener, drawn as the picture; `null` for a character run. */
  point: PlanSpan | null;
  figure: boolean;
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
  readonly kind: "milestone" | "optbreak" | "standalone" | "unruled";
  readonly name: string;
  readonly form: MarkForm;
}

/** A standalone marker that opens its line: `from..to` is the marker, not the line. */
export interface ResolvedStandalone {
  readonly from: number;
  readonly to: number;
  readonly form: MarkForm;
}

export interface ResolvedLine {
  readonly hidden: readonly PlanSpan[];
  readonly paints: boolean;
  readonly slot: ResolvedSlot | null;
  readonly standalone: ResolvedStandalone | null;
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
  readonly verseLines: boolean;
  /** Whether a sidebar draws its box (`sidebar` paints ambient). */
  readonly sidebarBox: boolean;
  readonly notes: readonly ResolvedNote[];
  readonly noteAt: ReadonlyMap<number, ResolvedNote>;
  readonly words: readonly ResolvedWord[];
  readonly wordAt: ReadonlyMap<number, ResolvedWord>;
  readonly apparatus: readonly ResolvedApparatus[];
  readonly line: (n: number) => ResolvedLine;
  readonly block: (i: number) => ResolvedBlock;
  readonly verse: (k: number) => ResolvedSlot;
  readonly atomic: (line: DocLine) => readonly PlanSpan[];
  readonly targets: () => OwnedIndex;
}

function callerMark(i: number): string {
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

function resolveNote(note: NoteRange, rows: Registry): ResolvedNote {
  const paint = (classKey: ClassKey): PaintReach => rows[classKey].cell.paint;
  const head = { from: note.from, to: note.to, kind: note.kind, parts: note.parts, mark: "" };
  if (paint("note.markup") === "none" && paint("note.body") === "none") {
    return paint("note.caller") === "none"
      ? { ...head, form: "elided", point: null, hidden: [{ from: note.from, to: note.to }] }
      : { ...head, form: "collapsed", point: { from: note.from, to: note.to }, hidden: [] };
  }
  const hidden = new Spans();
  const take = (from: number, to: number, classKey: ClassKey) => {
    if (paint(classKey) === "none") hidden.push(from, to);
  };
  let at = note.from;
  for (const p of note.parts) {
    if (p.from >= note.to) break;
    const to = Math.min(p.to, note.to);
    if (to <= at) continue;
    take(at, p.from, "note.markup");
    take(Math.max(at, p.from), to, partClass(p.kind));
    at = to;
  }
  take(at, note.to, "note.markup");
  return { ...head, form: "expanded", point: null, hidden: hidden.out };
}

function resolveWord(word: WordRange, rows: Registry, mask: (pos: number) => number): ResolvedWord {
  if (word.figure) return resolveFigure(word, rows, mask);
  const paint = rows.char.cell.paint;
  const hidden = new Spans();
  if (paint !== "point") {
    hidden.push(mask(word.from), word.surfaceFrom);
    hidden.push(mask(word.attrFrom), word.attrTo);
    hidden.push(mask(word.attrTo), word.to);
  }
  return {
    from: word.from,
    to: word.to,
    scope: paint === "ambient" ? { from: word.surfaceFrom, to: word.surfaceTo } : null,
    hidden: hidden.out,
    point: null,
    figure: false,
  };
}

/**
 * A figure: its opener is the `figure` class's point (the picture) or hidden
 * with the rest when a projection paints figures `none`; its attributes and
 * closer are hidden chrome; its caption, the surface, is content and stays.
 */
function resolveFigure(
  word: WordRange,
  rows: Registry,
  mask: (pos: number) => number,
): ResolvedWord {
  const paint = rows.figure.cell.paint;
  const hidden = new Spans();
  const opener = { from: mask(word.from), to: word.surfaceFrom };
  if (paint !== "point") hidden.push(opener.from, opener.to);
  hidden.push(mask(word.attrFrom), word.attrTo);
  hidden.push(mask(word.attrTo), word.to);
  return {
    from: word.from,
    to: word.to,
    scope: { from: word.surfaceFrom, to: word.surfaceTo },
    hidden: hidden.out,
    point: paint === "point" && opener.to > opener.from ? opener : null,
    figure: true,
  };
}

class PlanLine implements ResolvedLine {
  readonly hidden: readonly PlanSpan[];
  readonly paints: boolean;
  readonly slot: ResolvedSlot | null;
  readonly standalone: ResolvedStandalone | null;
  readonly #line: DocLine;
  readonly #milestone: MarkForm;
  readonly #optbreak: MarkForm;
  readonly #standaloneForm: MarkForm;
  readonly #unruledForm: MarkForm;
  #marks: readonly ResolvedMark[] | null = null;

  constructor(
    line: DocLine,
    hidden: readonly PlanSpan[],
    paints: boolean,
    slot: ResolvedSlot | null,
    standalone: ResolvedStandalone | null,
    milestone: MarkForm,
    optbreak: MarkForm,
    standaloneForm: MarkForm,
    unruledForm: MarkForm,
  ) {
    this.#line = line;
    this.hidden = hidden;
    this.paints = paints;
    this.slot = slot;
    this.standalone = standalone;
    this.#milestone = milestone;
    this.#optbreak = optbreak;
    this.#standaloneForm = standaloneForm;
    this.#unruledForm = unruledForm;
  }

  get marks(): readonly ResolvedMark[] {
    if (this.#marks) return this.#marks;
    const line = this.#line;
    const out: ResolvedMark[] = [];
    for (const m of line.milestones)
      out.push({ from: m.from, to: m.to, kind: "milestone", name: m.name, form: this.#milestone });
    for (const u of line.unruled)
      out.push({ from: u.from, to: u.to, kind: "unruled", name: u.name, form: this.#unruledForm });
    for (const b of line.breaks)
      out.push({ from: b.from, to: b.to, kind: "optbreak", name: "", form: this.#optbreak });
    for (const m of line.standalones)
      out.push({
        from: m.from,
        to: m.to,
        kind: "standalone",
        name: "",
        form: this.#standaloneForm,
      });
    this.#marks = out.length ? out : NO_MARKS;
    return this.#marks;
  }
}

function ownedIndexOf(structure: DocStructure, plan: DocPlan, a: Assignment): OwnedIndex {
  if (!armed()) return buildOwnedIndex(structure, plan, a);
  const done = span("index", "build");
  try {
    return buildOwnedIndex(structure, plan, a);
  } finally {
    done();
  }
}

export function resolvePlan(structure: DocStructure, a: Assignment): DocPlan {
  const rows = a.rows;
  const paint = (classKey: ClassKey): PaintReach => rows[classKey].cell.paint;
  const pipped = (classKey: ClassKey): boolean =>
    a.clamped.some((c) => c.cls === classKey && c.to === "pip");

  const notes: ResolvedNote[] = [];
  const noteAt = new Map<number, ResolvedNote>();
  const atomicNotes: ResolvedNote[] = [];
  for (const n of structure.notes) {
    const resolved = resolveNote(n, rows);
    notes.push(resolved);
    noteAt.set(resolved.from, resolved);
    if (resolved.form !== "expanded") atomicNotes.push(resolved);
  }

  const mask = (pos: number): number => {
    let at = pos;
    for (const n of atomicNotes) if (n.from <= at && n.to > at) at = Math.max(at, n.to);
    return at;
  };

  const words: ResolvedWord[] = [];
  const wordAt = new Map<number, ResolvedWord>();
  for (const w of structure.words) {
    const r = resolveWord(w, rows, mask);
    words.push(r);
    wordAt.set(r.from, r);
  }

  const chapterOf = new Map<number, number>();
  structure.chapters.forEach((ch, i) => {
    const last = Math.min(ch.lastLine, structure.lines.length);
    if (ch.line > last) return;
    const lo = structure.lines.fromAt(ch.line - 1);
    const hi = structure.lines.toAt(last - 1);
    for (const note of structure.notes)
      if (note.from >= lo && note.from <= hi) chapterOf.set(note.from, i);
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
  structure.chapters.forEach((ch, i) => {
    const list = shown.get(i);
    const lastLine = Math.min(ch.lastLine, structure.lines.length);
    if (!list || !list.length || lastLine < 1) return;
    apparatus.push({ at: structure.lines.toAt(lastLine - 1), chapter: ch, notes: list });
  });

  const chromeHidden = paint("chrome") === "none";
  const standaloneForm: MarkForm = paint("standalone") === "point" ? "point" : "hidden";
  const milestoneForm: MarkForm = paint("milestone") === "point" ? "point" : "hidden";
  const optbreakForm: MarkForm = paint("optbreak") === "point" ? "point" : "hidden";
  const unruledForm: MarkForm = paint("unruled") === "point" ? "point" : "hidden";
  const blankElided = paint("blank") === "none";
  const breaks = paint("newline.between") === "boundary";
  const joinWidget: WidgetKey | null =
    paint("newline.inside") === "point" ? (rows["newline.inside"].widget ?? null) : null;
  const joinKind: ReflowKind = joinWidget ? "join" : "hide";
  const pipV = pipped("slot.v");
  const pipC = pipped("slot.c");
  const docLen =
    structure.analysis?.docLen ??
    (structure.lines.length ? structure.lines.toAt(structure.lines.length - 1) : 0);

  const slotOf = (
    kind: "v" | "c",
    from: number,
    markerEnd: number,
    numFrom: number,
    numTo: number,
    contentFrom: number,
    num: string | null,
  ): ResolvedSlot => {
    const classKey: ClassKey = kind === "v" ? "slot.v" : "slot.c";
    const residual = rows[classKey].residual ? (rows[classKey].widget ?? null) : null;
    const head = { kind, from, to: contentFrom, num, residual };
    if (paint(classKey) === "none")
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

  const verses: (ResolvedSlot | null)[] = Array.from(
    { length: structure.verses.length },
    () => null,
  );
  const verse = (k: number): ResolvedSlot => {
    let r = verses[k];
    if (!r) {
      const verse: VerseRow = structure.verses[k];
      r = slotOf(
        "v",
        verse.markerFrom,
        verse.markerTo,
        verse.numFrom,
        verse.numTo,
        verse.contentFrom,
        verse.num,
      );
      verses[k] = r;
    }
    return r;
  };

  const resolveLine = (line: DocLine): ResolvedLine => {
    let hidden: readonly PlanSpan[] = NO_SPANS;
    let paints = false;
    let slot: ResolvedSlot | null = null;
    let standalone: ResolvedStandalone | null = null;
    if (paintsItsOwnLine(line)) {
      paints = paint(line.cls) !== "none";
      if (chromeHidden && line.contentFrom > line.from)
        hidden = [{ from: line.from, to: line.contentFrom }];
    } else if (line.cls === "standalone") {
      standalone = { from: line.from, to: line.contentFrom, form: standaloneForm };
    } else if (line.cls === "slot.c") {
      slot = slotOf(
        "c",
        line.from,
        line.markerEnd,
        line.numFrom,
        line.numTo,
        line.contentFrom,
        line.num,
      );
      paints = slot.form !== "elided";
    }
    return new PlanLine(
      line,
      hidden,
      paints,
      slot,
      standalone,
      milestoneForm,
      optbreakForm,
      standaloneForm,
      unruledForm,
    );
  };

  const lines: (ResolvedLine | null)[] = Array.from({ length: structure.lines.length }, () => null);
  const line = (n: number): ResolvedLine => {
    let r = lines[n - 1];
    if (!r) {
      r = resolveLine(structure.lines.at(n - 1));
      lines[n - 1] = r;
    }
    return r;
  };

  /**
   * A container (`sidebar`): its extent holds other blocks, which resolve
   * their own lines, so it reflows nothing. It hides only its own markup: its
   * opener up to where its content starts, and its closer, with the line the
   * closer stands alone on so the box ends on its last words.
   */
  const resolveContainer = (b: Block): ResolvedBlock => {
    const reflow: ReflowSpan[] = [];
    const head = b.lines[0];
    if (chromeHidden && head !== undefined && head.contentFrom > head.from)
      reflow.push({ from: head.from, to: head.contentFrom, kind: "hide" });
    const last = b.lines[b.lines.length - 1];
    const text = structure.analysis?.text ?? "";
    if (chromeHidden && last !== undefined && last !== head) {
      const closer = text.lastIndexOf("\\", last.to);
      if (closer >= last.from) {
        const alone = text.slice(last.from, closer).trim() === "";
        const from = alone && last.from > 0 ? last.from - 1 : closer;
        reflow.push({ from, to: last.to, kind: "hide" });
      }
    }
    return {
      reflow,
      joined: 0,
      paints: paint(b.cls) !== "none",
      startsLine: true,
      headHidden: null,
      inblk: null,
      breakAt: null,
    };
  };

  const resolveBlock = (b: Block): ResolvedBlock => {
    if (isContainerClass(b.cls)) return resolveContainer(b);
    const reflow: ReflowSpan[] = [];
    const push = (from: number, to: number, kind: ReflowKind) => {
      if (to > from) reflow.push({ from, to, kind });
    };
    const rows2 = b.lines;
    const holdsText = rows2.some((l) => !isBlankLine(l) && l.contentFrom < l.to);
    let prevEnd = -1;
    let joined = 0;
    let gapTo = -1;
    const swallow = (line: DocLine) => {
      push(prevEnd >= 0 ? prevEnd : line.from, Math.min(line.to + 1, docLen), "hide");
      prevEnd = -1;
    };
    const closeGap = (to: number) => {
      if (gapTo < 0) return;
      push(prevEnd, prevEnd + 1, joinKind);
      push(prevEnd + 1, to, "hide");
      joined++;
      gapTo = -1;
      prevEnd = -1;
    };
    const trailGap = () => {
      if (gapTo < 0) return;
      push(prevEnd, gapTo, "hide");
      gapTo = -1;
      prevEnd = -1;
    };
    const invisible = (line: DocLine) =>
      isBlankLine(line) ||
      (line.cls === "standalone" && standaloneForm === "hidden" && line.contentFrom >= line.to);
    for (const l of rows2) {
      if (opensAParagraph(l)) {
        trailGap();
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
        prevEnd = breaks ? l.to : -1;
        continue;
      }
      if (invisible(l)) {
        if (!breaks && isBlankLine(l)) continue;
        if (prevEnd >= 0) gapTo = l.to;
        else if (breaks) swallow(l);
        else push(l.from, l.to, "hide");
        continue;
      }
      if (gapTo >= 0) closeGap(l.from);
      else if (prevEnd >= 0) {
        push(prevEnd, l.from, joinKind);
        joined++;
      }
      prevEnd = breaks ? l.to : -1;
    }
    trailGap();
    const at = lineIndexAt(structure, b.from);
    const startsLine = at >= 0 && structure.lines.fromAt(at) === b.from;
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

  const blocks: (ResolvedBlock | null)[] = Array.from(
    { length: structure.blocks.length },
    () => null,
  );
  const block = (i: number): ResolvedBlock => {
    let r = blocks[i];
    if (!r) {
      r = resolveBlock(structure.blocks.at(i));
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
      if (r?.point) out.push({ from: r.point.from, to: r.point.to });
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
    revision: structure.revision,
    docLen,
    joinWidget,
    verseLines: a.verseLines,
    sidebarBox: paint("sidebar") === "ambient",
    notes,
    noteAt,
    words,
    wordAt,
    apparatus,
    line,
    block,
    verse,
    atomic,
    targets: () => (targetIndex ??= ownedIndexOf(structure, plan, a)),
  };
  return plan;
}
