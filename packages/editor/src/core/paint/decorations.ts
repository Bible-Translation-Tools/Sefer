import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  Direction,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { MARKERS } from "@sefer/text/engine/analysis";
import {
  FLAG,
  NOTE_PART,
  TOKEN,
  TOKEN_SPELLING_BIT,
  classWordOf,
} from "@sefer/text/engine/analysis";

import { figureSource } from "../figures";
import { trusted } from "../kernel";
import { lineIndexAt, type DocStructure, type NoteRange } from "../model/docStructure";
import type { DocLine, WordRange } from "../model/fold";
import type { WidgetKey } from "../model/registry";
import { chipRenderer, markupOf } from "../unsupported";
import { chapterTitles, emptyChapters, keptAsReading, type KeptAsReading } from "../verseLines";
import { markerWords, phrase } from "../words";
import { blockHost } from "./blockHost";
import { chapterWordTyped, writeOwnLabel } from "./chapterWord";
import { inPlaceWords } from "./inPlace";
import type { DocPlan, PlanSpan, ResolvedSlot } from "./plan";

class JoinWidget extends WidgetType {
  readonly glyph: string;
  constructor(glyph: string) {
    super();
    this.glyph = glyph;
  }
  eq(other: JoinWidget) {
    return other.glyph === this.glyph;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "usfm-join";
    span.textContent = this.glyph;
    return span;
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
  eq(other: EmptySlotWidget) {
    return other.kind === this.kind;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `usfm-slot usfm-slot-${this.kind}`;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

/**
 * An empty chapter's empty state, as ghost text where the caret already
 * waits: "Click here to start editing Icipandwa 6" in its first leftover
 * paragraph, behind the verse number it will get. Typing replaces it like any
 * placeholder, and the first keystroke writes that verse (`\\v 1`). A chapter with no
 * paragraph at all has nowhere to type, so there the ghost is clickable and
 * writes one (`\\p`) in place of whatever was left, the caret in it.
 */
/** The verse the first keystroke writes (`typeIntoEmptyChapter`, core/verseLines.ts), shown ahead of time. */
const emptyChapterVerse = (): HTMLElement => {
  const verse = document.createElement("span");
  verse.className = "usfm-chap-empty-verse";
  verse.textContent = "1";
  return verse;
};

/** That verse number alone, BEFORE the caret, so the caret sits between it and the ghost text. */
class EmptyChapterVerseWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    // Wrapped at the text's own size: the caret is drawn against this
    // widget's box, and the superscript alone would make it a short caret.
    const lead = document.createElement("span");
    lead.className = "usfm-chap-empty-lead";
    lead.append(emptyChapterVerse());
    return lead;
  }
}

class EmptyChapterWidget extends WidgetType {
  constructor(
    readonly title: string | undefined,
    readonly number: string,
    readonly writes?: { readonly from: number; readonly to: number },
  ) {
    super();
  }
  eq(other: EmptyChapterWidget) {
    return (
      other.title === this.title &&
      other.number === this.number &&
      other.writes?.from === this.writes?.from &&
      other.writes?.to === this.writes?.to
    );
  }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = "usfm-chap-empty";
    const title = this.title ?? `${phrase(view.state, "verseLines.chapter")} ${this.number}`;
    span.textContent = phrase(view.state, "emptyChapter.prompt", { title });
    const writes = this.writes;
    if (writes !== undefined) {
      span.prepend(emptyChapterVerse());
      span.classList.add("usfm-chap-empty-writes");
      span.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const insert = "\n\\p ";
        view.dispatch({
          changes: { from: writes.from, to: writes.to, insert },
          selection: { anchor: writes.from + insert.length },
          annotations: trusted.of("empty-chapter"),
          userEvent: "input.type",
          scrollIntoView: true,
        });
        view.focus();
      });
    }
    return span;
  }
  ignoreEvent() {
    return this.writes !== undefined;
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
  eq(other: PipWidget) {
    return other.name === this.name;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "usfm-pip";
    span.title = `\\${this.name}`;
    span.textContent = this.name.endsWith("-s") ? "⟦" : "⟧";
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

/**
 * A figure's picture: the host's (`figureSource`) when it resolves the `src`,
 * else a frame labelled in the host's words. As wide as USFM's `size` says:
 * `col` one text column, drawn half the text's width; `span` the page, all of it.
 */
class FigureWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly size: "col" | "span",
    readonly title: string,
  ) {
    super();
  }
  eq(other: FigureWidget) {
    return other.src === this.src && other.size === this.size && other.title === this.title;
  }
  toDOM(view: EditorView) {
    const figure = document.createElement("span");
    figure.className = "usfm-fig";
    figure.dataset.size = this.size;
    figure.title = this.title;
    const picture = this.src === "" ? undefined : view.state.facet(figureSource)?.(this.src);
    if (picture !== undefined) {
      const image = document.createElement("img");
      image.src = picture;
      image.alt = "";
      image.draggable = false;
      figure.append(image);
    } else {
      const frame = document.createElement("span");
      frame.className = "usfm-fig-frame";
      frame.textContent = markerWords(view.state, "fig", false);
      figure.append(frame);
    }
    return figure;
  }
  ignoreEvent() {
    return false;
  }
}

const FIGURE_CAPTION = Decoration.mark({ class: "usfm-fig-caption" });

/**
 * A table cell's marker: a thin column separator, none before the row's first
 * cell. Its words are an ordinary run after it (`usfm-cell`, its column in
 * `data-col` for a layout to align on).
 */
class CellWidget extends WidgetType {
  constructor(readonly first: boolean) {
    super();
  }
  eq(other: CellWidget) {
    return other.first === this.first;
  }
  toDOM() {
    const separator = document.createElement("span");
    separator.className = this.first ? "usfm-cell-sep usfm-cell-sep-first" : "usfm-cell-sep";
    return separator;
  }
  ignoreEvent() {
    return false;
  }
}

/** `\thr3` → a header cell, right-aligned, column 3. */
const cellShape = (
  spelled: string,
): { header: boolean; align: "start" | "center" | "end"; col: number } => {
  const m = /^\\t([hc])([rc]?)(\d*)/.exec(spelled);
  const align = m?.[2] === "r" ? "end" : m?.[2] === "c" ? "center" : "start";
  return { header: m?.[1] === "h", align, col: Number(m?.[3] || "1") };
};

/** A published chapter's (`\cp`) line, a caption under the chapter number. */
const CP_LINE = Decoration.line({ class: "usfm-cp" });

/**
 * An `unruled` mark: a chip, drawn by the host's renderer (`chipRenderer`)
 * or as a plain label in the host's words.
 */
class ChipWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly text: string,
  ) {
    super();
  }
  eq(other: ChipWidget) {
    return other.text === this.text;
  }
  toDOM(view: EditorView) {
    const markup = markupOf(view.state, this.from, this.to, this.text);
    const render = view.state.facet(chipRenderer);
    if (render !== null) return render(markup, view);
    const chip = document.createElement("span");
    chip.className = markup.closing ? "usfm-chip usfm-chip-end" : "usfm-chip";
    chip.textContent = markup.label;
    chip.title = markup.text.trim();
    return chip;
  }
  ignoreEvent() {
    return false;
  }
}

/** A figure's widget, its `src` and `size` broken from its attribute list by the engine. */
function figureWidget(doc: string, structure: DocStructure, word: WordRange): FigureWidget {
  const list =
    word.attrTo > word.attrFrom && structure.analysis !== null
      ? structure.analysis.attrs(word.attrFrom, word.attrTo).attrs
      : [];
  const named = list.map(({ name, value }) => ({
    name: name.from === name.to ? "default" : doc.slice(name.from, name.to),
    value: doc.slice(value.from, value.to),
  }));
  const src = named.find((a) => a.name === "src")?.value ?? "";
  const size = named.find((a) => a.name === "size")?.value === "span" ? "span" : "col";
  return new FigureWidget(src, size, named.map((a) => `${a.name}: ${a.value}`).join("\n"));
}

class VersePipWidget extends WidgetType {
  readonly num: string;
  constructor(num: string) {
    super();
    this.num = num;
  }
  eq(other: VersePipWidget) {
    return other.num === this.num;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "usfm-verse-pip";
    span.title = `verse ${this.num}`;
    span.textContent = this.num;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

const WIDGETS: Record<WidgetKey, (arg: string) => WidgetType> = {
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
  eq(other: CallerWidget) {
    return other.mark === this.mark && other.kind === this.kind && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = `usfm-caller usfm-caller-${this.kind}`;
    span.dataset["noteAt"] = String(this.at);
    span.textContent = this.mark;
    span.title = "click to read or edit this note";
    span.onmousedown = (e) => {
      e.preventDefault();
      toggleNote(view, this.at, "caller");
    };
    return span;
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

const EMPTY_NOTE_BODY = "Add note text";

/** The book's short name, as its running header gives it: `\h`, else `\toc2`, else `\id`'s code. */
const bookNameOf = (doc: string): string =>
  (/\\h[ \t]+([^\n\\]+)/.exec(doc) ??
    /\\toc2[ \t]+([^\n\\]+)/.exec(doc) ??
    /\\id[ \t]+(\S+)/.exec(doc))?.[1]?.trim() ?? "";

/**
 * Where a note is, as a reader cites it: `Luke 3:4`. The note's row shows it
 * as the link back to its letter, whatever its own `\fr` says.
 */
export function noteReference(doc: string, structure: DocStructure, at: number): string {
  const chapter = structure.chapters.findLast((row) => row.from <= at);
  const c =
    chapter === undefined
      ? undefined
      : /^\\c[ \t]+(\d+)/.exec(doc.slice(chapter.from, chapter.from + 16))?.[1];
  const verse = structure.verses.findLast(
    (row) => row.markerFrom <= at && (chapter === undefined || row.markerFrom >= chapter.from),
  )?.num;
  const place = c === undefined ? (verse ?? "") : verse == null ? c : `${c}:${verse}`;
  return [bookNameOf(doc), place].filter((part) => part !== "").join(" ");
}

/**
 * Paints one apparatus row's body span.
 *
 * A note with no text yet — which is every note the moment `Insert footnote`
 * makes one — would render as an EMPTY span. An empty inline span is zero
 * pixels wide, so the one target in the row that means "let me write this"
 * would be unclickable exactly when a reader most wants it: the note exists,
 * the caller is in the text, and the body cannot be reached by pointer at all.
 * So an empty body wears a placeholder, and the placeholder is the click
 * target. It is a class and not a `::after`, because the click handler asks
 * `closest(".usfm-note-body")` and pseudo-elements have no node to close over.
 */
export const paintNoteBody = (el: HTMLElement, text: string): void => {
  const empty = text === "";
  el.className = empty ? "usfm-note-body usfm-note-empty" : "usfm-note-body";
  const want = empty ? EMPTY_NOTE_BODY : text;
  if (el.textContent !== want) el.textContent = want;
};

class NotesWidget extends WidgetType {
  readonly notes: { mark: string; ref: string; body: string; from: number }[];
  constructor(notes: { mark: string; ref: string; body: string; from: number }[]) {
    super();
    this.notes = notes;
  }
  eq(other: NotesWidget) {
    return (
      other.notes.length === this.notes.length &&
      other.notes.every((n, i) => n.mark === this.notes[i].mark && n.body === this.notes[i].body)
    );
  }
  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "usfm-notes";
    for (const n of this.notes) {
      const row = document.createElement("div");
      row.className = "usfm-note";
      row.dataset.noteRow = String(n.from);
      row.title = "click the note to edit it, or its reference to go back to the text";
      row.onmousedown = (e) => {
        // SAFETY: a mousedown on a rendered row always targets an element inside it; `closest` is the only thing read from it.
        const target = e.target as HTMLElement;
        if (target.closest(".usfm-note-edit") || target.closest(".usfm-note-done")) return;
        e.preventDefault();
        if (target.closest(".usfm-note-remove") !== null) {
          toggleNote(view, n.from, "remove");
          return;
        }
        toggleNote(view, n.from, target.closest(".usfm-note-body") === null ? "back" : "edit");
      };
      for (const [cls, text] of [
        ["usfm-note-mark", n.mark],
        ["usfm-note-ref", n.ref],
      ] as const) {
        const el = document.createElement("span");
        el.className = cls;
        el.textContent = text;
        row.append(el);
      }
      const body = document.createElement("span");
      paintNoteBody(body, n.body);
      row.append(body);
      const slot = document.createElement("span");
      slot.className = "usfm-note-edit";
      row.append(slot);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "usfm-note-remove";
      remove.textContent = "Remove";
      row.append(remove);
      box.append(row);
    }
    return blockHost(box);
  }

  updateDOM(dom: HTMLElement): boolean {
    const rows = dom.querySelectorAll<HTMLElement>(".usfm-note");
    if (rows.length !== this.notes.length) return false;
    this.notes.forEach((n, i) => {
      const row = rows[i];
      if (row.dataset.noteRow !== String(n.from)) return;
      const open = row.querySelector(".usfm-note-edit")?.firstChild != null;
      const set = (className: string, text: string) => {
        const el = row.querySelector<HTMLElement>(`.${className}`);
        if (el && el.textContent !== text && !open) el.textContent = text;
      };
      set("usfm-note-mark", n.mark);
      set("usfm-note-ref", n.ref);
      const body = row.querySelector<HTMLElement>(".usfm-note-body");
      if (body !== null && !open) paintNoteBody(body, n.body);
    });
    return true;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * What a reader meant by clicking a note.
 *
 * `caller` is a click on the superscript in the text — open the note in a
 * popover there. `back` is a click on a row's mark or its reference — go back up to
 * the caller. `edit` is a click on a row's BODY — open it for typing.
 * `remove` is its Remove button — take the note out.
 */
export type NoteGesture = "caller" | "back" | "edit" | "remove";

let toggleNote: (view: EditorView, at: number, how: NoteGesture) => void = () => {};
export function setNoteToggler(toggle: typeof toggleNote) {
  toggleNote = toggle;
}

export const DEFAULT_BUILD_OPTS: BuildOpts = {};

export interface BuildOpts {
  window?: { from: number; to: number } | null;
  range?: { from: number; to: number } | null;
  /**
   * The surface's own clip — a card's stretch of the book, `recipes/satellite`'s
   * scope — for what is ANCHORED at a boundary rather than spread over a span:
   * a chapter's notes sit after its last line, one character before the next
   * chapter's `\c`, so a clip starting there touches that chapter's span and
   * would draw its notes above the excerpt. `null` when the whole book shows.
   */
  clip?: { from: number; to: number } | null;
  highlight?: string | null;
  focus?: { from: number; to: number } | null;
}

function narrow(
  windowRange: { from: number; to: number } | null | undefined,
  range: { from: number; to: number } | null | undefined,
): { from: number; to: number } | null {
  if (!windowRange) return range ?? null;
  if (!range) return windowRange;
  return { from: Math.max(windowRange.from, range.from), to: Math.min(windowRange.to, range.to) };
}

function windowLines(
  structure: DocStructure,
  windowRange: { from: number; to: number } | null,
): { readonly first: number; readonly last: number } {
  if (windowRange === null) return { first: 0, last: structure.lines.length - 1 };
  return {
    first: Math.max(0, lineIndexAt(structure, windowRange.from)),
    last: lineIndexAt(structure, windowRange.to),
  };
}

type TokenRows = NonNullable<DocStructure["analysis"]>["dish"]["tokens"]["rows"];

function forTokensIn(
  rows: TokenRows,
  windowRange: { from: number; to: number } | null,
  visit: (kindBits: number, markerIdx: number, from: number, to: number) => void,
): void {
  let first = 0;
  if (windowRange !== null) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (rows.seek(mid).start <= windowRange.from) low = mid + 1;
      else high = mid;
    }
    first = Math.max(0, low - 1);
  }
  for (let i = first, n = rows.length; i < n; i++) {
    const token = rows.seek(i);
    if (windowRange !== null && token.start > windowRange.to) break;
    visit(token.kind, token.marker, token.start, token.end);
  }
}

export interface BuildResult {
  set: DecorationSet;
  stats: { decorations: number; joined: number; blocks: number };
}

class BreakWidget extends WidgetType {
  readonly cls: string;
  constructor(className: string) {
    super();
    this.cls = className;
  }
  eq(other: BreakWidget) {
    return other.cls === this.cls;
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

// SAFETY: this literal IS the spec, written here and nowhere else; the assertion only widens it to what `Decoration.replace` accepts.
const UNIT = { usfmUnit: true } as Record<string, unknown>;
const HIDDEN = Decoration.replace(UNIT);

type DecorationSpec = {
  usfmUnit?: boolean;
  usfmIsolate?: boolean;
  widget?: unknown;
  block?: boolean;
  class?: string;
  attributes?: unknown;
};

// SAFETY: `spec` is `any` in CodeMirror's types; every read of it goes through here and compares optional fields, so a spec without them answers false or undefined.
const specOf = (deco: Decoration): DecorationSpec => deco.spec;

export function isUnit(deco: Decoration) {
  return specOf(deco).usfmUnit === true;
}

export function isInvisible(deco: Decoration) {
  const spec = specOf(deco);
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

export function isIsolate(deco: Decoration) {
  return specOf(deco).usfmIsolate === true;
}

const DELIMITER = Decoration.mark({ class: "usfm-delim" });

/** A verse number hung in the margin, and the space after it, which the hang takes up. */
const NUM_HUNG = Decoration.mark({
  class: "usfm-num usfm-num-v usfm-num-hung",
  bidiIsolate: Direction.LTR,
  usfmIsolate: true,
});
const DELIMITER_HUNG = Decoration.mark({ class: "usfm-delim usfm-delim-hung" });

/**
 * The verses whose number hangs in the margin (ecthesis): in line by line every
 * verse; otherwise a verse that opens a poetry line, so each poetry level's
 * words start at the same place with or without a number.
 */
function hungVerses(doc: string, structure: DocStructure, plan: DocPlan): Set<number> {
  const verses = structure.verses;
  if (plan.verseLines) return new Set(verses.map((verse) => verse.markerFrom));
  const hung = new Set<number>();
  let k = 0;
  for (let i = 0; i < structure.blocks.length; i++) {
    const block = structure.blocks.at(i);
    if (!block.poetry || !plan.block(i).startsLine) continue;
    while (k < verses.length && verses[k].markerFrom < block.contentFrom) k++;
    const verse = verses[k];
    if (verse === undefined || verse.markerFrom >= block.to) continue;
    if (doc.slice(block.contentFrom, verse.markerFrom).trim() === "") hung.add(verse.markerFrom);
  }
  return hung;
}

export function buildRegular(
  doc: string,
  structure: DocStructure,
  plan: DocPlan,
  opts: BuildOpts,
): BuildResult {
  const add: Pending[] = [];
  let joined = 0;
  const join = plan.joinWidget
    ? Decoration.replace({ widget: WIDGETS[plan.joinWidget](""), ...UNIT })
    : HIDDEN;
  const windowRange = narrow(opts.window, opts.range);
  const outside = (from: number, to: number) =>
    windowRange !== null &&
    windowRange !== undefined &&
    (to < windowRange.from || from > windowRange.to);
  const hide = (from: number, to: number) => {
    if (to > from) add.push({ from, to, deco: HIDDEN });
  };
  const hideAll = (spans: readonly PlanSpan[]) => {
    for (const h of spans) hide(h.from, h.to);
  };

  const slot = (r: ResolvedSlot, hung = false) => {
    if (r.form === "pip" && r.residual) {
      add.push({
        from: r.from,
        to: r.to,
        deco: Decoration.replace({ widget: WIDGETS[r.residual](r.num ?? ""), ...UNIT }),
      });
      return;
    }
    hideAll(r.hidden);
    if (r.digits)
      add.push({
        from: r.digits.from,
        to: r.digits.to,
        deco: hung && r.kind === "v" ? NUM_HUNG : NUM_ISOLATE[r.kind],
      });
    if (r.delimiter)
      add.push({
        from: r.delimiter.from,
        to: r.delimiter.to,
        deco: hung ? DELIMITER_HUNG : DELIMITER,
      });
    if (r.box !== null)
      add.push({
        from: r.box,
        to: r.box,
        deco: Decoration.widget({ widget: new EmptySlotWidget(r.kind), side: 1 }),
      });
  };

  const rows = windowLines(structure, windowRange);
  for (let row = rows.first; row <= rows.last; row++) {
    const l = structure.lines.at(row);
    if (outside(l.from, l.to)) continue;
    const resolvedLine = plan.line(l.n);
    if (l.cls === "block.meta" || l.cls === "block.front") {
      if (resolvedLine.paints)
        add.push({
          from: l.from,
          to: l.from,
          deco: Decoration.line({
            class: l.cls === "block.meta" ? "usfm-meta" : `usfm-front usfm-${l.marker}`,
          }),
        });
      hideAll(resolvedLine.hidden);
    } else if (l.cls === "block.heading") {
      hideAll(resolvedLine.hidden);
    } else if (resolvedLine.standalone) {
      if (resolvedLine.standalone.form === "hidden")
        hide(resolvedLine.standalone.from, resolvedLine.standalone.to);
    } else if (resolvedLine.slot) {
      if (resolvedLine.paints)
        add.push({ from: l.from, to: l.from, deco: Decoration.line({ class: "usfm-chap" }) });
      slot(resolvedLine.slot);
    }

    for (const m of resolvedLine.marks) {
      if (m.form !== "point") {
        hide(m.from, m.to);
        continue;
      }
      if (m.kind === "standalone" || m.kind === "cell") continue;
      if (m.kind === "unruled") {
        const text = doc.slice(m.from, m.to);
        if (m.from === l.from && /^\\cp\b/.test(text))
          add.push({ from: l.from, to: l.from, deco: CP_LINE });
        add.push({
          from: m.from,
          to: m.to,
          deco: Decoration.replace({ widget: new ChipWidget(m.from, m.to, text), ...UNIT }),
        });
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

    const cells = resolvedLine.marks.filter((m) => m.kind === "cell" && m.form === "point");
    cells.forEach((cell, at) => {
      const shape = cellShape(doc.slice(cell.from, cell.to));
      add.push({
        from: cell.from,
        to: cell.to,
        deco: Decoration.replace({ widget: new CellWidget(at === 0), ...UNIT }),
      });
      const contentTo = cells[at + 1]?.from ?? l.to;
      if (contentTo > cell.to)
        add.push({
          from: cell.to,
          to: contentTo,
          deco: Decoration.mark({
            class: `usfm-cell${shape.header ? " usfm-cell-head" : ""} usfm-cell-${shape.align}`,
            attributes: { "data-col": String(shape.col) },
          }),
        });
    });

    for (const wd of l.words) {
      const resolvedWord = plan.wordAt.get(wd.from);
      if (!resolvedWord) continue;
      hideAll(resolvedWord.hidden);
      if (resolvedWord.point)
        add.push({
          from: resolvedWord.point.from,
          to: resolvedWord.point.to,
          deco: Decoration.replace({ widget: figureWidget(doc, structure, wd), ...UNIT }),
        });
      if (resolvedWord.scope && resolvedWord.scope.to > resolvedWord.scope.from)
        add.push({
          from: resolvedWord.scope.from,
          to: resolvedWord.scope.to,
          deco: resolvedWord.figure
            ? FIGURE_CAPTION
            : Decoration.mark({
                class: `usfm-word usfm-c-${(MARKERS[wd.marker]?.name ?? "").replace(/^\+/, "")}`,
                attributes: { "data-w": String(resolvedWord.from) },
              }),
        });
    }
  }

  const hung = hungVerses(doc, structure, plan);
  for (let k = 0; k < structure.verses.length; k++) {
    const v = structure.verses[k];
    if (outside(v.markerFrom, v.contentFrom)) continue;
    slot(plan.verse(k), hung.has(v.markerFrom));
  }

  if (opts.highlight) {
    const needle = opts.highlight.toLowerCase();
    const lo = windowRange ? Math.max(0, windowRange.from - needle.length) : 0;
    const hi = windowRange ? Math.min(doc.length, windowRange.to + needle.length) : doc.length;
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

  if (plan.sidebarBox)
    for (let i = 0; i < structure.blocks.length; i++) {
      if (structure.blocks.clsAt(i) !== "sidebar") continue;
      const from = structure.blocks.fromAt(i);
      const to = structure.blocks.toAt(i);
      if (outside(from, to)) continue;
      const first = doc.lastIndexOf("\n", from - 1) + 1;
      for (let at = first; at <= to;) {
        const end = doc.indexOf("\n", at);
        const lineTo = end < 0 || end > to ? to : end;
        // The last line shown: a closer alone on the line after is hidden with it (`resolveContainer`).
        const next = end < 0 || end >= to ? -1 : end + 1;
        const shownLast =
          lineTo >= to || (next >= 0 && /^\s*\\[A-Za-z]+\s*$/.test(doc.slice(next, to)));
        const edges = `${at === first ? " usfm-sidebar-first" : ""}${shownLast ? " usfm-sidebar-last" : ""}`;
        add.push({ from: at, to: at, deco: Decoration.line({ class: `usfm-sidebar${edges}` }) });
        if (end < 0 || end >= to) break;
        at = end + 1;
      }
    }

  // Line by line keeps a table and a sidebar as Reading draws them, on their own lines.
  const kept = plan.verseLines ? keptAsReading(structure) : null;
  if (kept !== null) joined += layOutVerseLines(doc, structure, plan, add, outside, kept);
  nameChapters(doc, structure, add, outside);
  for (let i = 0; i < structure.blocks.length; i++) {
    if (kept !== null && !kept.blocks.has(i)) continue;
    if (outside(structure.blocks.fromAt(i), structure.blocks.toAt(i))) continue;
    const b = structure.blocks.at(i);
    const resolvedBlock = plan.block(i);
    for (const r of resolvedBlock.reflow) {
      if (r.kind === "hide") {
        add.push({ from: r.from, to: r.to, deco: HIDDEN });
        continue;
      }
      add.push({ from: r.from, to: r.to, deco: join });
    }
    joined += resolvedBlock.joined;
    const head = b.cls === "block.heading" ? " usfm-head" : "";
    const className = resolvedBlock.paints ? `usfm-block usfm-${b.kind}${head}` : "";
    if (resolvedBlock.startsLine) {
      if (className)
        add.push({ from: b.from, to: b.from, deco: Decoration.line({ class: className }) });
      continue;
    }
    if (resolvedBlock.headHidden) hide(resolvedBlock.headHidden.from, resolvedBlock.headHidden.to);
    if (resolvedBlock.breakAt !== null)
      add.push({
        from: resolvedBlock.breakAt,
        to: resolvedBlock.breakAt,
        deco: Decoration.widget({ widget: new BreakWidget(className), side: -1 }),
      });
    if (resolvedBlock.inblk)
      add.push({
        from: resolvedBlock.inblk.from,
        to: resolvedBlock.inblk.to,
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
  const clip = opts.clip;
  for (const ap of plan.apparatus) {
    if (outside(ap.chapter.from, ap.chapter.to)) continue;
    if (clip !== null && clip !== undefined && (ap.at < clip.from || ap.at > clip.to)) continue;
    add.push({
      from: ap.at,
      to: ap.at,
      deco: Decoration.widget({
        widget: new NotesWidget(
          ap.notes.map((n) => ({
            mark: n.mark,
            ref: noteReference(doc, structure, n.from),
            body: noteApparatusText(doc, n, NOTE_PART.BODY),
            from: n.from,
          })),
        ),
        block: true,
        side: 1,
      }),
    });
  }

  hideEmptyChapters(doc, structure, add, outside);
  return finish(add, doc, opts, { joined, blocks: structure.blocks.length });
}

class VerseSeparatorWidget extends WidgetType {
  readonly poetry: boolean;
  constructor(poetry: boolean) {
    super();
    this.poetry = poetry;
  }
  eq(other: VerseSeparatorWidget) {
    return other.poetry === this.poetry;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.poetry ? "usfm-verse-sep usfm-verse-sep-poetry" : "usfm-verse-sep";
    span.textContent = this.poetry ? " / " : " ";
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

const separator = (poetry: boolean): Decoration =>
  Decoration.replace({ widget: new VerseSeparatorWidget(poetry), ...UNIT });

const VERSE_BREAK = Decoration.widget({ widget: new BreakWidget("usfm-verse-break"), side: -1 });
const VERSE_LINE = Decoration.line({ class: "usfm-verse-line" });
const VERSE_HEADING = Decoration.line({ class: "usfm-verse-heading" });

const isPoetryMarker = (marker: string | null): boolean => marker?.startsWith("q") === true;

/**
 * Line-by-line: one verse per visual line, whatever the file's layout. A line
 * that opens a verse, a chapter or a heading keeps its newline before it; any
 * other newline is inside a verse and is drawn as a space, or a thin slash
 * before poetry. A verse that starts mid-line gets a drawn break. Nothing is
 * written: the text and its offsets stay as they are.
 */
function layOutVerseLines(
  doc: string,
  structure: DocStructure,
  plan: DocPlan,
  add: Pending[],
  outside: (from: number, to: number) => boolean,
  kept: KeptAsReading,
): number {
  const isKept = (pos: number): boolean =>
    kept.spans.some((span) => pos >= span.from && pos <= span.to);
  const verseStarts = new Set(structure.verses.map((verse) => verse.markerFrom));
  const opensVerse = (line: DocLine): boolean =>
    verseStarts.has(line.contentFrom) || verseStarts.has(line.from);
  const standsAlone = (line: DocLine): boolean =>
    isKept(line.from) ||
    line.cls === "slot.c" ||
    line.cls === "block.heading" ||
    line.cls === "block.meta" ||
    line.cls === "block.front";
  // An empty chapter's waiting paragraph shows its prompt: a line of its own.
  const waiting = new Set(
    emptyChapters(doc, structure).flatMap((chapter) =>
      chapter.field === undefined ? [] : [chapter.field.line],
    ),
  );
  const showsNothing = (line: DocLine): boolean =>
    line.cls !== "slot.c" &&
    !opensVerse(line) &&
    !waiting.has(line.from) &&
    line.contentFrom >= line.to;
  const lineStarts = new Set<number>();

  let joined = 0;
  let previous: DocLine | null = null;
  for (const line of structure.lines) {
    if (showsNothing(line)) continue;
    const visibleFrom = opensVerse(line) ? line.from : line.contentFrom;
    if (previous !== null && !outside(previous.to, line.contentFrom)) {
      const keepsBreak = opensVerse(line) || standsAlone(line) || standsAlone(previous);
      if (keepsBreak) {
        // A chapter line keeps its own line, and with it its title's classes:
        // the empty lines before it fold into the line above instead.
        if (line.cls === "slot.c" && line.from > previous.to + 1)
          add.push({ from: previous.to, to: line.from - 1, deco: HIDDEN });
        else if (line.from > previous.to + 1)
          add.push({ from: previous.to + 1, to: line.from, deco: HIDDEN });
      } else {
        add.push({
          from: previous.to,
          to: line.contentFrom,
          deco: separator(isPoetryMarker(line.marker)),
        });
        joined++;
      }
    }
    if (isKept(line.from)) {
      lineStarts.add(line.from);
      lineStarts.add(line.contentFrom);
      previous = line;
      continue;
    }
    if (line.cls === "block.para" && line.contentFrom > line.from && visibleFrom === line.from)
      add.push({ from: line.from, to: line.contentFrom, deco: HIDDEN });
    else if (waiting.has(line.from) && line.contentFrom > line.from)
      add.push({ from: line.from, to: line.contentFrom, deco: HIDDEN });
    const visualStart = previous === null ? line.from : previous.to + 1;
    if (opensVerse(line) && !outside(visualStart, visualStart))
      add.push({ from: visualStart, to: visualStart, deco: VERSE_LINE });
    if (line.cls === "block.heading" && !outside(visualStart, visualStart))
      add.push({ from: visualStart, to: visualStart, deco: VERSE_HEADING });
    lineStarts.add(line.from);
    lineStarts.add(line.contentFrom);
    previous = line;
  }

  for (let i = 0; i < structure.blocks.length; i++) {
    if (kept.blocks.has(i)) continue;
    const block = structure.blocks.at(i);
    if (plan.block(i).startsLine || outside(block.from, block.contentFrom)) continue;
    if (verseStarts.has(block.contentFrom)) {
      if (block.contentFrom > block.from)
        add.push({ from: block.from, to: block.contentFrom, deco: HIDDEN });
      continue;
    }
    add.push({ from: block.from, to: block.contentFrom, deco: separator(block.poetry) });
  }

  for (const verse of structure.verses) {
    if (lineStarts.has(verse.markerFrom) || outside(verse.markerFrom, verse.markerFrom)) continue;
    add.push({ from: verse.markerFrom, to: verse.markerFrom, deco: VERSE_BREAK });
  }
  return joined;
}

const CHAPTER_TITLE = Decoration.line({ class: "usfm-chap-title" });
const CHAPTER_NAMED = Decoration.line({ class: "usfm-chap-named" });

/** A CSS string for `content`: quoted, its quotes and backslashes escaped. */
const cssString = (text: string): string => `"${text.replace(/["\\]/g, "\\$&")}"`;

/** Reading's and line by line's chapter titles (`chapterTitles`, core/verseLines.ts), drawn, with an empty chapter's empty state (`emptyChapters`). */
function nameChapters(
  doc: string,
  structure: DocStructure,
  add: Pending[],
  outside: (from: number, to: number) => boolean,
): void {
  const { bookLabel, chapters } = chapterTitles(doc, structure);
  const namedDeco =
    bookLabel === ""
      ? CHAPTER_NAMED
      : Decoration.line({
          class: "usfm-chap-named",
          attributes: { style: `--usfm-chapter-label: ${cssString(bookLabel)}` },
        });
  // A chapter's own label lines are hidden whole, with the line break before
  // each, so nothing is left of them; its `\\c` line, when it has a label,
  // shows that label in place of the number. Only those lines: a heading
  // between them stays the text's.
  const hides: { from: number; to: number }[] = [];
  const titled: { at: number; to: number; own: string }[] = [];
  for (const chapter of chapters) {
    const line = chapter.line;
    if (outside(line.from, Math.max(line.to, ...chapter.labels.map((label) => label.to)))) continue;
    // An empty `\\cl` names nothing and is left as it was.
    for (const label of chapter.labels)
      if (doc.slice(label.contentFrom, label.to).trim() !== "")
        hides.push({ from: Math.max(0, label.from - 1), to: label.to });
    if (chapter.own === undefined) {
      add.push({ from: line.from, to: line.from, deco: namedDeco });
      // The word before the number, typed into where it reads (`chapterWordTyped`).
      const row = structure.chapters.find((c) => c.from >= line.from && c.from <= line.to);
      if (row !== undefined && row.label !== "")
        add.push({
          from: row.labelFrom,
          to: row.labelFrom,
          deco: Decoration.widget({ widget: new ChapterWordWidget(bookLabel), side: -1 }),
        });
    } else titled.push({ at: line.from, to: line.to, own: chapter.own });
  }
  for (const title of titled) hides.push({ from: title.at, to: title.to });
  wordLines(doc, structure, bookLabel, add, outside);
  if (hides.length === 0) return;
  // Hides already inside one (the marker, the number) and a hidden line's own
  // line class go first: of two that overlap only the earlier is kept.
  const inside = (d: Pending): boolean =>
    hides.some(
      (h) =>
        (d.to > d.from && specOf(d.deco).class === undefined && d.from >= h.from && d.to <= h.to) ||
        (d.from === d.to &&
          d.from > h.from &&
          d.from <= h.to &&
          h.from < h.to &&
          doc[h.from] === "\n"),
    );
  for (let k = add.length - 1; k >= 0; k--) if (inside(add[k])) add.splice(k, 1);
  for (const hide of hides) if (hide.to > hide.from) add.push({ ...hide, deco: HIDDEN });
  for (const title of titled) {
    add.push({ from: title.at, to: title.at, deco: CHAPTER_TITLE });
    add.push({
      from: title.to,
      to: title.to,
      deco: Decoration.widget({ widget: new ChapterTitleWidget(title.own, title.at), side: 1 }),
    });
  }
}

/**
 * The book's own `\\cl` line, before its first chapter: its word typed into
 * where it reads, as on a title, asking this book or every book.
 */
function wordLines(
  doc: string,
  structure: DocStructure,
  bookLabel: string,
  add: Pending[],
  outside: (from: number, to: number) => boolean,
): void {
  if (bookLabel === "") return;
  const first = structure.chapters.find((row) => row.label !== "")?.from ?? doc.length;
  for (const line of structure.lines) {
    if (line.from >= first) break;
    if (line.marker !== "cl" || line.to <= line.contentFrom) continue;
    if (outside(line.contentFrom, line.to)) continue;
    for (let k = add.length - 1; k >= 0; k--)
      if (add[k].from >= line.contentFrom && add[k].to <= line.to && add[k].to > add[k].from)
        add.splice(k, 1);
    add.push({
      from: line.contentFrom,
      to: line.to,
      deco: Decoration.replace({ widget: new ChapterWordWidget(bookLabel, false) }),
    });
  }
}

/** A chapter's own label, drawn as its title on its `\\c` line, and typed into there. */
class ChapterTitleWidget extends WidgetType {
  constructor(
    readonly words: string,
    readonly at: number,
  ) {
    super();
  }
  eq(other: ChapterTitleWidget) {
    return other.words === this.words && other.at === this.at;
  }
  toDOM(view: EditorView) {
    // Wrapped: CodeMirror makes a widget's own root not editable.
    const wrap = document.createElement("span");
    // "icipandwa 1", "Psalm 3": the book's word and the number. Only the word
    // is typed into, and a new one asks this book or every book.
    const split = /^(.*\S)\s+(\p{Nd}+)$/u.exec(this.words);
    if (split !== null) {
      const word = split[1];
      wrap.className = "usfm-chap-label";
      const span = inPlaceWords({
        value: word,
        className: "usfm-chap-label-word",
        commit: (typed) => chapterWordTyped(view, typed, span, () => (span.textContent = word)),
      });
      wrap.style.position = "relative";
      wrap.append(span, ` ${split[2]}`);
      return wrap;
    }
    wrap.append(
      inPlaceWords({
        value: this.words,
        className: "usfm-chap-label",
        commit: (typed, span) => {
          if (typed === "") span.textContent = this.words;
          else writeOwnLabel(view, this.at, typed);
        },
      }),
    );
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * The book's word for its chapters ("Chapter", "Psalm"), before a chapter's
 * number, typed into where it reads: a new word asks this book or every book.
 */
class ChapterWordWidget extends WidgetType {
  constructor(
    readonly bookLabel: string,
    readonly beforeNumber = true,
  ) {
    super();
  }
  eq(other: ChapterWordWidget) {
    return other.bookLabel === this.bookLabel && other.beforeNumber === this.beforeNumber;
  }
  toDOM(view: EditorView) {
    const value = this.bookLabel === "" ? phrase(view.state, "verseLines.chapter") : this.bookLabel;
    const wrap = document.createElement("span");
    wrap.className = "usfm-chap-word-wrap";
    const span = inPlaceWords({
      value,
      className: "usfm-chap-word",
      commit: (typed) => chapterWordTyped(view, typed, span, () => (span.textContent = value)),
    });
    wrap.append(span);
    if (this.beforeNumber) wrap.append(" ");
    else wrap.classList.add("usfm-chap-word-line");
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * An empty chapter: its first leftover paragraph keeps the caret and shows
 * the empty state as ghost text (`EmptyChapterWidget`); every other leftover
 * marker (an empty `\\v`, a bare `\\q2`) is hidden, the ghost doing their work.
 * Last of all, so whatever was drawn inside them goes first; then one hide
 * over them all. USFM still shows them.
 */
function hideEmptyChapters(
  doc: string,
  structure: DocStructure,
  add: Pending[],
  outside: (from: number, to: number) => boolean,
): void {
  for (const empty of emptyChapters(doc, structure)) {
    if (outside(empty.at, empty.to)) continue;
    const kept = empty.field;
    // Hidden: everything left but the kept paragraph's own line — what comes
    // before it (a section mark, a blank line) and what comes after.
    const hides =
      kept === undefined
        ? [{ from: empty.at, to: empty.to }]
        : [
            { from: empty.at, to: Math.max(empty.at, kept.line - 1) },
            { from: kept.to, to: empty.to },
          ];
    for (const hide of hides) {
      if (hide.to <= hide.from) continue;
      for (let k = add.length - 1; k >= 0; k--)
        if (add[k].from > hide.from && add[k].to <= hide.to) add.splice(k, 1);
      add.push({ from: hide.from, to: hide.to, deco: HIDDEN });
    }
    const ghost =
      kept === undefined
        ? new EmptyChapterWidget(empty.title, empty.number, { from: empty.at, to: empty.to })
        : new EmptyChapterWidget(empty.title, empty.number);
    const at = kept === undefined ? empty.at : kept.from;
    // Number, caret, ghost: the number before the caret's position, the words after it.
    if (kept !== undefined)
      add.push({
        from: at,
        to: at,
        deco: Decoration.widget({ widget: new EmptyChapterVerseWidget(), side: -1 }),
      });
    add.push({
      from: at,
      to: at,
      deco: Decoration.widget({ widget: ghost, side: kept === undefined ? -1 : 1 }),
    });
  }
}

function setOfPending(add: Pending[]): DecorationSet {
  add.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const d of add) {
    if (d.to > d.from && specOf(d.deco).class === undefined) {
      if (d.from < lastTo) continue;
      lastTo = d.to;
    }
    builder.add(d.from, d.to, d.deco);
  }
  return builder.finish();
}

export function buildNoteApparatus(
  doc: string,
  structure: DocStructure,
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
  const parts = structure.notes
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

  return setOfPending(add);
}

export function buildUsfm(doc: string, structure: DocStructure, opts: BuildOpts): BuildResult {
  const add: Pending[] = [];
  const windowRange = narrow(opts.window, opts.range);
  const outside = (from: number, to: number) =>
    windowRange !== null && (to < windowRange.from || from > windowRange.to);
  const rows = windowLines(structure, windowRange);
  for (let row = rows.first; row <= rows.last; row++) {
    const l = structure.lines.at(row);
    if (outside(l.from, l.to)) continue;
    if (l.marker)
      add.push({
        from: l.from,
        to: l.from,
        deco: Decoration.line({ class: `usfm-src usfm-src-${l.marker}` }),
      });
  }
  const dish = structure.analysis?.dish;
  if (dish) {
    forTokensIn(dish.tokens.rows, windowRange, (kindBits, markerIdx, from, to) => {
      if (to <= from || outside(from, to)) return;
      const kind = kindBits & ~TOKEN_SPELLING_BIT;
      const className = tokenClass(kind, classWordOf(markerIdx, kindBits));
      if (className) add.push({ from, to, deco: Decoration.mark({ class: className }) });
    });
  }
  return finish(add, doc, opts, { joined: 0, blocks: structure.blocks.length });
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

  const isReplace = (deco: Decoration) => {
    const spec = specOf(deco);
    return spec.class === undefined && spec.attributes === undefined;
  };
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  let n = 0;
  for (const d of add) {
    let { from, to } = d;
    if (to > from && isReplace(d.deco)) {
      if (from < lastTo) {
        if (specOf(d.deco).widget !== undefined || to <= lastTo) continue;
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
