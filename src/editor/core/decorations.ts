/**
 * Structure and plan into CodeMirror decorations — the whole of what the reader
 * actually sees.
 *
 * Two builders, because the two modes are genuinely different pictures:
 * `buildRegular` hides markup and draws widgets in its place; `buildUsfm` shows
 * the source with syntax classes. Both emit atomic ranges and bidi isolates
 * alongside the visible set, because a hidden marker the caret can walk into and
 * an RTL verse that reorders its own markup are the same class of bug.
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  Direction,
  EditorView,
  WidgetType,
} from "@codemirror/view";

import { FLAG, NOTE_PART, TOKEN, TOKEN_SPELLING_BIT, classWordOf } from "../../core/galley";
import { lineIndexAt, type DocStructure, type NoteRange } from "./docStructure";
import type { DocPlan, PlanSpan, ResolvedSlot } from "./plan";
import type { WidgetKey } from "./registry";

class JoinWidget extends WidgetType {
  readonly glyph: string;
  constructor(glyph: string) {
    super();
    this.glyph = glyph;
  }
  eq(o: JoinWidget) {
    return o.glyph === this.glyph;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "usfm-join";
    s.textContent = this.glyph;
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

class EmptySlotWidget extends WidgetType {
  readonly kind: "v" | "c";
  constructor(kind: "v" | "c") {
    super();
    this.kind = kind;
  }
  eq(o: EmptySlotWidget) {
    return o.kind === this.kind;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = `usfm-slot usfm-slot-${this.kind}`;
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

class OptBreakWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    return document.createElement("br");
  }
  ignoreEvent() {
    return false;
  }
}

class PipWidget extends WidgetType {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
  eq(o: PipWidget) {
    return o.name === this.name;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "usfm-pip";
    s.title = `\\${this.name}`;
    s.textContent = this.name.endsWith("-s") ? "⟦" : "⟧";
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

class ChunkWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "usfm-chunk";
    s.title = "\\s5 chunk marker";
    return s;
  }
}

class VersePipWidget extends WidgetType {
  readonly num: string;
  constructor(num: string) {
    super();
    this.num = num;
  }
  eq(o: VersePipWidget) {
    return o.num === this.num;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "usfm-verse-pip";
    s.title = `verse ${this.num}`;
    s.textContent = this.num;
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

export const WIDGETS: Record<WidgetKey, (arg: string) => WidgetType> = {
  versePip: (num) => new VersePipWidget(num),
  join: () => new JoinWidget(" "),
  joinSigil: () => new JoinWidget("\u21b5"),
};

class CallerWidget extends WidgetType {
  readonly mark: string;
  readonly kind: string;
  readonly at: number;
  constructor(mark: string, kind: string, at: number) {
    super();
    this.mark = mark;
    this.kind = kind;
    this.at = at;
  }
  eq(o: CallerWidget) {
    return o.mark === this.mark && o.kind === this.kind && o.at === this.at;
  }
  toDOM(view: EditorView) {
    const s = document.createElement("span");
    s.className = `usfm-caller usfm-caller-${this.kind}`;
    s.textContent = this.mark;
    s.title = "click to edit this note in the apparatus";
    s.onmousedown = (e) => {
      e.preventDefault();
      toggleNote(view, this.at);
    };
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

export function noteApparatusText(doc: string, note: NoteRange, part: number): string {
  let out = "";
  for (const p of note.parts) if (p.kind === part) out += doc.slice(p.from, p.to);
  return out.replace(/\s+/g, " ").trim();
}

class NotesWidget extends WidgetType {
  readonly notes: { mark: string; ref: string; body: string; from: number }[];
  constructor(notes: { mark: string; ref: string; body: string; from: number }[]) {
    super();
    this.notes = notes;
  }
  eq(o: NotesWidget) {
    return (
      o.notes.length === this.notes.length &&
      o.notes.every((n, i) => n.mark === this.notes[i].mark && n.body === this.notes[i].body)
    );
  }
  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "usfm-notes";
    for (const n of this.notes) {
      const row = document.createElement("div");
      row.className = "usfm-note";
      row.dataset.noteRow = String(n.from);
      row.title = "click to edit this note here";
      row.onmousedown = (e) => {
        // SAFETY: a mousedown on a rendered row always targets an element
        // inside it; `closest` is the only thing read from it.
        if ((e.target as HTMLElement).closest(".usfm-note-edit")) return;
        e.preventDefault();
        toggleNote(view, n.from, true);
      };
      for (const [cls, text] of [
        ["usfm-note-mark", n.mark],
        ["usfm-note-ref", n.ref],
        ["usfm-note-body", n.body],
      ] as const) {
        const el = document.createElement("span");
        el.className = cls;
        el.textContent = text;
        row.append(el);
      }
      const slot = document.createElement("span");
      slot.className = "usfm-note-edit";
      row.append(slot);
      box.append(row);
    }
    return box;
  }

  updateDOM(dom: HTMLElement): boolean {
    const rows = dom.querySelectorAll<HTMLElement>(".usfm-note");
    if (rows.length !== this.notes.length) return false;
    this.notes.forEach((n, i) => {
      const row = rows[i];
      if (row.dataset.noteRow !== String(n.from)) return;
      const set = (cls: string, text: string) => {
        const el = row.querySelector<HTMLElement>(`.${cls}`);
        if (el && el.textContent !== text && !row.querySelector(".usfm-note-edit")?.firstChild)
          el.textContent = text;
      };
      set("usfm-note-mark", n.mark);
      set("usfm-note-ref", n.ref);
      set("usfm-note-body", n.body);
    });
    return true;
  }

  ignoreEvent() {
    return false;
  }
}

export let toggleNote: (view: EditorView, at: number, scroll?: boolean) => void = () => {};
export function setNoteToggler(fn: typeof toggleNote) {
  toggleNote = fn;
}

export const DEFAULT_BUILD_OPTS: BuildOpts = {};

export interface BuildOpts {
  window?: { from: number; to: number } | null;
  range?: { from: number; to: number } | null;
  highlight?: string | null;
  focus?: { from: number; to: number } | null;
}

function narrow(
  win: { from: number; to: number } | null | undefined,
  range: { from: number; to: number } | null | undefined,
): { from: number; to: number } | null {
  if (!win) return range ?? null;
  if (!range) return win;
  return { from: Math.max(win.from, range.from), to: Math.min(win.to, range.to) };
}

export interface BuildResult {
  set: DecorationSet;
  stats: { decorations: number; joined: number; blocks: number };
}

class BreakWidget extends WidgetType {
  readonly cls: string;
  constructor(cls: string) {
    super();
    this.cls = cls;
  }
  eq(o: BreakWidget) {
    return o.cls === this.cls;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `usfm-brk ${this.cls}`;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

type Pending = { from: number; to: number; deco: Decoration };

// Decoration specs are untyped bags (CodeMirror types `spec` as `any`), so
// the editor's own flags are read back through the narrow shapes below rather
// than trusted. SAFETY: this literal IS the spec, written here and nowhere
// else; the assertion only widens it to what `Decoration.replace` accepts.
const UNIT = { usfmUnit: true } as Record<string, unknown>;
const HIDDEN = Decoration.replace(UNIT);

export function isUnit(d: Decoration) {
  // SAFETY: `spec` is `any` in CodeMirror's types; this reads one optional
  // flag and compares it to `true`, so a spec without it answers false.
  return (d.spec as { usfmUnit?: boolean }).usfmUnit === true;
}

export function isInvisible(d: Decoration) {
  // SAFETY: as `isUnit` — three optional fields read off an `any` spec.
  const spec = d.spec as { usfmUnit?: boolean; widget?: unknown; block?: boolean };
  return spec.usfmUnit === true && spec.widget === undefined;
}

const NUM_ISOLATE: Record<"v" | "c", Decoration> = {
  v: Decoration.mark({
    class: "usfm-num usfm-num-v",
    bidiIsolate: Direction.LTR,
    usfmIsolate: true,
  }),
  c: Decoration.mark({
    class: "usfm-num usfm-num-c",
    bidiIsolate: Direction.LTR,
    usfmIsolate: true,
  }),
};

export function isIsolate(d: Decoration) {
  // SAFETY: as `isUnit` — one optional flag read off an `any` spec.
  return (d.spec as { usfmIsolate?: boolean }).usfmIsolate === true;
}

const DELIMITER = Decoration.mark({ class: "usfm-delim" });

export function buildRegular(
  doc: string,
  s: DocStructure,
  plan: DocPlan,
  opts: BuildOpts,
): BuildResult {
  const add: Pending[] = [];
  let joined = 0;
  const join = plan.joinWidget
    ? Decoration.replace({ widget: WIDGETS[plan.joinWidget](""), ...UNIT })
    : HIDDEN;
  const win = narrow(opts.window, opts.range);
  const outside = (from: number, to: number) =>
    win !== null && win !== undefined && (to < win.from || from > win.to);
  const hide = (from: number, to: number) => {
    if (to > from) add.push({ from, to, deco: HIDDEN });
  };
  const hideAll = (spans: readonly PlanSpan[]) => {
    for (const h of spans) hide(h.from, h.to);
  };

  const slot = (r: ResolvedSlot) => {
    if (r.form === "pip" && r.residual) {
      add.push({
        from: r.from,
        to: r.to,
        deco: Decoration.replace({ widget: WIDGETS[r.residual](r.num ?? ""), ...UNIT }),
      });
      return;
    }
    hideAll(r.hidden);
    if (r.digits) add.push({ from: r.digits.from, to: r.digits.to, deco: NUM_ISOLATE[r.kind] });
    if (r.delimiter) add.push({ from: r.delimiter.from, to: r.delimiter.to, deco: DELIMITER });
    if (r.box !== null)
      add.push({
        from: r.box,
        to: r.box,
        deco: Decoration.widget({ widget: new EmptySlotWidget(r.kind), side: -1 }),
      });
  };

  const firstRow = win ? Math.max(0, lineIndexAt(s, win.from)) : 0;
  const lastRow = win ? lineIndexAt(s, win.to) : s.lines.length - 1;
  for (let row = firstRow; row <= lastRow; row++) {
    const l = s.lines.at(row);
    if (outside(l.from, l.to)) continue;
    const rl = plan.line(l.n);
    if (l.cls === "block.meta" || l.cls === "block.front") {
      if (rl.paints)
        add.push({
          from: l.from,
          to: l.from,
          deco: Decoration.line({
            class: l.cls === "block.meta" ? "usfm-meta" : `usfm-front usfm-${l.marker}`,
          }),
        });
      hideAll(rl.hidden);
    } else if (l.cls === "block.heading") {
      hideAll(rl.hidden);
    } else if (rl.chunk) {
      add.push({
        from: rl.chunk.from,
        to: rl.chunk.to,
        deco: Decoration.replace(
          rl.chunk.form === "point" ? { widget: new ChunkWidget(), ...UNIT } : UNIT,
        ),
      });
    } else if (rl.slot) {
      if (rl.paints)
        add.push({ from: l.from, to: l.from, deco: Decoration.line({ class: "usfm-chap" }) });
      slot(rl.slot);
    }

    for (const m of rl.marks) {
      if (m.form !== "point") {
        hide(m.from, m.to);
        continue;
      }
      add.push({
        from: m.from,
        to: m.to,
        deco: Decoration.replace(
          m.kind === "milestone"
            ? { widget: new PipWidget(m.name), ...UNIT }
            : { widget: new OptBreakWidget(), ...UNIT },
        ),
      });
    }

    for (const wd of l.words) {
      const w = plan.wordAt.get(wd.from);
      if (!w) continue;
      hideAll(w.hidden);
      if (w.scope)
        add.push({
          from: w.scope.from,
          to: w.scope.to,
          deco: Decoration.mark({ class: "usfm-word", attributes: { "data-w": String(w.from) } }),
        });
    }
  }

  for (let k = 0; k < s.verses.length; k++) {
    const v = s.verses[k];
    if (outside(v.markerFrom, v.contentFrom)) continue;
    slot(plan.verse(k));
  }

  if (opts.highlight) {
    const needle = opts.highlight.toLowerCase();
    const lo = win ? Math.max(0, win.from - needle.length) : 0;
    const hi = win ? Math.min(doc.length, win.to + needle.length) : doc.length;
    const hay = doc.slice(lo, hi).toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
      add.push({
        from: lo + i,
        to: lo + i + needle.length,
        deco: Decoration.mark({ class: "usfm-hit" }),
      });
    }
  }
  if (opts.focus) {
    add.push({
      from: opts.focus.from,
      to: opts.focus.from,
      deco: Decoration.line({ class: "usfm-focus" }),
    });
  }

  for (let i = 0; i < s.blocks.length; i++) {
    if (outside(s.blocks.fromAt(i), s.blocks.toAt(i))) continue;
    const b = s.blocks.at(i);
    const rb = plan.block(i);
    for (const r of rb.reflow) {
      if (r.kind === "hide") {
        add.push({ from: r.from, to: r.to, deco: HIDDEN });
        continue;
      }
      if (r.kind === "join") {
        add.push({ from: r.from, to: r.to, deco: join });
        continue;
      }
      add.push({
        from: r.from,
        to: r.to,
        deco: Decoration.replace(
          r.kind === "chunk-point" ? { widget: new ChunkWidget(), ...UNIT } : UNIT,
        ),
      });
    }
    joined += rb.joined;
    const head = b.cls === "block.heading" ? " usfm-head" : "";
    const cls = rb.paints ? `usfm-block usfm-${b.kind}${head}` : "";
    if (rb.startsLine) {
      if (cls) add.push({ from: b.from, to: b.from, deco: Decoration.line({ class: cls }) });
      continue;
    }
    if (rb.headHidden) hide(rb.headHidden.from, rb.headHidden.to);
    if (rb.breakAt !== null)
      add.push({
        from: rb.breakAt,
        to: rb.breakAt,
        deco: Decoration.widget({ widget: new BreakWidget(cls), side: -1 }),
      });
    if (rb.inblk)
      add.push({
        from: rb.inblk.from,
        to: rb.inblk.to,
        deco: Decoration.mark({ class: `usfm-inblk usfm-${b.kind}` }),
      });
  }

  for (const note of plan.notes) {
    if (outside(note.from, note.to)) continue;
    if (note.point) {
      add.push({
        from: note.point.from,
        to: note.point.to,
        deco: Decoration.replace({
          widget: new CallerWidget(note.mark, note.kind, note.from),
          ...UNIT,
        }),
      });
      continue;
    }
    hideAll(note.hidden);
  }
  for (const ap of plan.apparatus) {
    if (outside(ap.chapter.from, ap.chapter.to)) continue;
    add.push({
      from: ap.at,
      to: ap.at,
      deco: Decoration.widget({
        widget: new NotesWidget(
          ap.notes.map((n) => ({
            mark: n.mark,
            ref: noteApparatusText(doc, n, NOTE_PART.ORIGIN),
            body: noteApparatusText(doc, n, NOTE_PART.BODY),
            from: n.from,
          })),
        ),
        block: true,
        side: 1,
      }),
    });
  }

  return finish(add, doc, opts, { joined, blocks: s.blocks.length });
}

export function buildNoteApparatus(
  doc: string,
  s: DocStructure,
  range: { from: number; to: number },
): DecorationSet {
  const add: Pending[] = [];
  const hide = (from: number, to: number) => {
    if (to > from) add.push({ from, to, deco: HIDDEN });
  };
  const len = doc.length;
  const lineFrom = doc.lastIndexOf("\n", Math.max(0, range.from - 1)) + 1;
  const lineTo = doc.indexOf("\n", range.to) < 0 ? len : doc.indexOf("\n", range.to);
  if (lineFrom > 0)
    add.push({ from: 0, to: lineFrom - 1, deco: Decoration.replace({ block: true }) });
  hide(lineFrom, range.from);
  hide(range.to, lineTo);
  if (lineTo < len) add.push({ from: lineTo, to: len, deco: Decoration.replace({ block: true }) });

  let nested: string | null = null;
  let at = range.from;
  const parts = s.notes
    .filter((n) => n.to > range.from && n.from < range.to)
    .flatMap((n) => n.parts);
  for (const part of parts) {
    if (part.to <= range.from) continue;
    if (part.from >= range.to) break;
    hide(at, part.from);
    at = Math.max(at, part.to);
    if (part.kind === NOTE_PART.CALLER || part.kind === NOTE_PART.MARKUP) {
      const text = doc.slice(part.from, part.to);
      const open = /^\\\+([a-zA-Z]+\d*)\s*$/.exec(text);
      const close = /^\\\+?([a-zA-Z]+\d*)\*\s*$/.exec(text);
      if (open) nested = open[1];
      else if (close && nested === close[1]) nested = null;
      hide(part.from, part.to);
    } else if (part.kind === NOTE_PART.ORIGIN) {
      let end = part.to;
      while (end > part.from && /\s/.test(doc[end - 1])) end--;
      add.push({ from: part.from, to: end, deco: Decoration.mark({ class: "usfm-fr" }) });
      hide(end, part.to);
    } else {
      add.push({
        from: part.from,
        to: part.to,
        deco: Decoration.mark({
          class: nested ? `usfm-ft usfm-nested usfm-nested-${nested}` : "usfm-ft",
        }),
      });
    }
  }
  hide(at, range.to);

  add.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const d of add) {
    // SAFETY: one optional field read off CodeMirror's `any` spec; an absent
    // `class` is exactly the case being tested for.
    if (d.to > d.from && (d.deco.spec as { class?: string }).class === undefined) {
      if (d.from < lastTo) continue;
      lastTo = d.to;
    }
    builder.add(d.from, d.to, d.deco);
  }
  return builder.finish();
}

export function buildUsfm(doc: string, s: DocStructure, opts: BuildOpts): BuildResult {
  const add: Pending[] = [];
  const win = narrow(opts.window, opts.range);
  const outside = (from: number, to: number) => win !== null && (to < win.from || from > win.to);
  for (const l of s.lines) {
    if (outside(l.from, l.to)) continue;
    if (l.marker)
      add.push({
        from: l.from,
        to: l.from,
        deco: Decoration.line({ class: `usfm-src usfm-src-${l.marker}` }),
      });
  }
  const dish = s.analysis?.dish;
  if (dish) {
    dish.tokens.forEach((kindBits, markerIdx, from, to) => {
      if (to <= from || outside(from, to)) return;
      const kind = kindBits & ~TOKEN_SPELLING_BIT;
      const cls = tokenClass(kind, classWordOf(markerIdx, kindBits));
      if (cls) add.push({ from, to, deco: Decoration.mark({ class: cls }) });
    });
  }
  return finish(add, doc, opts, { joined: 0, blocks: s.blocks.length });
}

function tokenClass(kind: number, cls: number): string | null {
  const family = ["other", "para", "char", "note", "milestone", "chapverse", "sidebar", "table"][
    cls & 0b111
  ];
  switch (kind) {
    case TOKEN.MARKER:
    case TOKEN.CLOSING_MARKER:
      return `cm-usfm-marker cm-usfm-${family}${cls & FLAG.UNKNOWN ? " cm-usfm-unknown" : ""}`;
    case TOKEN.MILESTONE:
    case TOKEN.MILESTONE_TERMINATOR:
      return "cm-usfm-marker cm-usfm-milestone";
    case TOKEN.DESIGNATOR:
      return "cm-usfm-num";
    case TOKEN.ATTR_LIST:
      return "cm-usfm-attr";
    case TOKEN.NOTE_CALLER:
      return "cm-usfm-caller";
    case TOKEN.BOOK_CODE:
      return "cm-usfm-book";
    default:
      return null;
  }
}

function finish(
  add: Pending[],
  doc: string,
  opts: BuildOpts,
  extra: { joined: number; blocks: number },
): BuildResult {
  if (opts.window) {
    add = clipTo(add, doc, opts.window.from, opts.window.to);
  }

  add.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide || a.to - b.to);

  const isReplace = (d: Decoration) => {
    // SAFETY: two optional fields read off CodeMirror's `any` spec.
    const spec = d.spec as { class?: string; attributes?: unknown };
    return spec.class === undefined && spec.attributes === undefined;
  };
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  let n = 0;
  for (const d of add) {
    let { from, to } = d;
    if (to > from && isReplace(d.deco)) {
      if (from < lastTo) {
        // SAFETY: one optional field read off CodeMirror's `any` spec.
        const spec = d.deco.spec as { widget?: unknown };
        if (spec.widget !== undefined || to <= lastTo) continue;
        from = lastTo;
      }
      lastTo = to;
    }
    builder.add(from, to, d.deco);
    n++;
  }
  return { set: builder.finish(), stats: { decorations: n, ...extra } };
}

function clipTo(add: Pending[], doc: string, from: number, to: number): Pending[] {
  const kept = add.filter((d) => d.from >= from && d.to <= to);
  const out: Pending[] = [];
  if (from > 0) out.push({ from: 0, to: from - 1, deco: Decoration.replace({ block: true }) });
  out.push(...kept);
  const tail = Math.min(to, doc.length);
  if (tail < doc.length)
    out.push({
      from: Math.max(0, tail - 1),
      to: doc.length,
      deco: Decoration.replace({ block: true }),
    });
  return out;
}

export const baseTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
});
