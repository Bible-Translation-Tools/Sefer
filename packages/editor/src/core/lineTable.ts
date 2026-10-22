import { TOKEN } from "@sefer/text/engine/analysis";

import { spellingAt } from "./cst";
import {
  type DocLine,
  type Fold,
  type LineTable,
  type NoteRange,
  type WordRange,
  noRow,
} from "./fold";
import { chromeEndsAtMarkerToken, lineClassOf, lineOwnerRow, ownsItsLine } from "./mapping";
import { type ClassKey, paintsItsOwnLineAmbient } from "./registry";

const NO_NOTES: NoteRange[] = [];
const NO_WORDS: WordRange[] = [];
const NO_MILESTONES: { from: number; to: number; name: string }[] = [];
const NO_UNRULED: { from: number; to: number; name: string }[] = [];
const NO_BREAKS: { from: number; to: number }[] = [];
const NO_STANDALONES: { from: number; to: number }[] = [];

export const NO_LINES: LineTable = {
  length: 0,
  at: noRow,
  maybe: () => null,
  fromAt: noRow,
  toAt: noRow,
  indexAt: () => -1,
  *[Symbol.iterator]() {},
};

function openerOfLine(fold: Fold, from: number, to: number): number {
  const cst = fold.cst;
  const { startAt, endAt, kindAt } = cst;
  for (let i = cst.firstTokenFrom(from); i < cst.count && startAt[i] <= to; i++) {
    if (kindAt[i] === TOKEN.NEWLINE) return -1;
    if (endAt[i] <= startAt[i]) continue;
    if (cst.isHorizontalSpace(i)) continue;
    return cst.isLineOpening(i) && kindAt[i] === TOKEN.MARKER ? i : -1;
  }
  return -1;
}

class Line implements DocLine {
  readonly n: number;
  readonly from: number;
  readonly to: number;
  readonly #f: Fold;
  #opened = false;
  #walked = false;
  #cls: ClassKey = "block.para";
  #marker: string | null = null;
  #contentFrom: number;
  #markerEnd: number;
  #numFrom: number;
  #numTo: number;
  #num: string | null = null;
  #milestones = NO_MILESTONES;
  #breaks = NO_BREAKS;
  #standalones = NO_STANDALONES;
  #unruled = NO_UNRULED;
  #cells = NO_UNRULED;

  constructor(fold: Fold, n: number, from: number, to: number) {
    this.#f = fold;
    this.n = n;
    this.from = from;
    this.to = to;
    this.#contentFrom = from;
    this.#markerEnd = from;
    this.#numFrom = from;
    this.#numTo = from;
  }

  #open(): void {
    if (this.#opened) return;
    this.#opened = true;
    const f = this.#f;
    const cst = f.cst;
    const token = openerOfLine(f, this.from, this.to);
    if (token < 0) return;
    const owner = cst.nodeOfOpener[token];
    const row = lineOwnerRow(cst.rowAt(token), owner < 0 ? null : cst.nodes[owner].row);
    if (!ownsItsLine(row)) return;
    this.#cls = lineClassOf(row);
    this.#marker = spellingAt(cst, token, f.doc);
    this.#contentFrom = Math.min(f.contentAfter(token), this.to);
    this.#markerEnd = chromeEndsAtMarkerToken(this.#cls) ? cst.endAt[token] : this.#contentFrom;
    const v = f.verseOfToken[token];
    const c = f.chapterOfToken[token];
    if (v >= 0) {
      const verse = f.verses[v];
      this.#numFrom = verse.numFrom;
      this.#numTo = verse.numTo;
      this.#num = verse.num;
    } else if (c >= 0) {
      const chapter = f.chapters[c];
      this.#numFrom = chapter.labelFrom;
      this.#numTo = chapter.labelTo;
      this.#num = chapter.label || null;
    }
  }

  #walk(): void {
    if (this.#walked) return;
    this.#walked = true;
    const f = this.#f;
    const cst = f.cst;
    const spanning = cst.spanning;
    if (spanning.length === 0) return;
    const { startAt, endAt } = cst;
    const clip = f.clip;
    let lo = 0;
    let hi = spanning.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (startAt[spanning[mid]] < this.from) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < spanning.length && startAt[spanning[k]] <= this.to; k++) {
      const i = spanning[k];
      const from = startAt[i];
      const to = endAt[i];
      if (clip && (to < clip.from || from > clip.to)) continue;
      const row = cst.rowAt(i);
      if (row.id === "optbreak") {
        if (this.#breaks === NO_BREAKS) this.#breaks = [];
        this.#breaks.push({ from, to });
      } else if (row.id === "milestone.token") {
        // One milestone is one span: its marker, any attributes and its `\*`, so it draws as
        // one pip and the caret never stops between its pieces. A terminator reached on its
        // own was taken with the marker before it.
        if (
          cst.kindAt[i] === TOKEN.MILESTONE_TERMINATOR &&
          (this.#milestones.at(-1)?.to ?? -1) >= to
        )
          continue;
        let last = i;
        if (cst.kindAt[i] === TOKEN.MILESTONE)
          for (let j = i + 1; j < cst.count && startAt[j] < this.to; j++) {
            if (cst.kindAt[j] === TOKEN.MILESTONE_TERMINATOR) last = j;
            if (cst.kindAt[j] !== TOKEN.ATTR_LIST && !cst.isHorizontalSpace(j)) break;
          }
        if (this.#milestones === NO_MILESTONES) this.#milestones = [];
        this.#milestones.push({
          from,
          to: last === i ? cst.payloadEnd(i) : endAt[last],
          name: spellingAt(cst, i, f.doc),
        });
      } else if (row.set === "cell") {
        if (this.#cells === NO_UNRULED) this.#cells = [];
        this.#cells.push({ from, to, name: spellingAt(cst, i, f.doc) });
      } else if (row.set === "unruled") {
        // A milestone's own span already holds its attribute list.
        const milestone = this.#milestones.at(-1);
        if (milestone !== undefined && from >= milestone.from && to <= milestone.to) continue;
        if (this.#unruled === NO_UNRULED) this.#unruled = [];
        this.#unruled.push({ from, to, name: spellingAt(cst, i, f.doc) });
      } else if (row.set === "standalone" && row.line !== true) {
        if (this.#standalones === NO_STANDALONES) this.#standalones = [];
        this.#standalones.push({ from, to });
      }
    }
  }

  get cls(): ClassKey {
    this.#open();
    return this.#cls;
  }
  get marker(): string | null {
    this.#open();
    return this.#marker;
  }
  get contentFrom(): number {
    this.#open();
    return this.#contentFrom;
  }
  get markerEnd(): number {
    this.#open();
    return this.#markerEnd;
  }
  get numFrom(): number {
    this.#open();
    return this.#numFrom;
  }
  get numTo(): number {
    this.#open();
    return this.#numTo;
  }
  get num(): string | null {
    this.#open();
    return this.#num;
  }
  get cells(): { from: number; to: number; name: string }[] {
    this.#walk();
    return this.#cells;
  }
  get unruled(): { from: number; to: number; name: string }[] {
    this.#walk();
    return this.#unruled;
  }
  get milestones(): { from: number; to: number; name: string }[] {
    this.#walk();
    return this.#milestones;
  }
  get breaks(): { from: number; to: number }[] {
    this.#walk();
    return this.#breaks;
  }
  get standalones(): { from: number; to: number }[] {
    this.#walk();
    return this.#standalones;
  }
  get notes(): NoteRange[] {
    return this.#f.notesByLine.get(this.n) ?? NO_NOTES;
  }
  get words(): WordRange[] {
    return this.#f.wordsByLine.get(this.n) ?? NO_WORDS;
  }
}

export class Lines implements LineTable {
  readonly length: number;
  readonly #f: Fold;
  readonly #from: Uint32Array;
  readonly #to: Uint32Array;
  #memo: (Line | undefined)[] | null = null;

  constructor(fold: Fold, from: Uint32Array, to: Uint32Array, count: number) {
    this.#f = fold;
    this.#from = from;
    this.#to = to;
    this.length = count;
  }

  at(i: number): DocLine {
    if (i < 0 || i >= this.length) throw new RangeError(`line row ${i} of ${this.length}`);
    const memo = (this.#memo ??= Array.from<Line | undefined>({ length: this.length }));
    const held = memo[i];
    if (held) return held;
    const made = new Line(this.#f, i + 1, this.#from[i], this.#to[i]);
    memo[i] = made;
    return made;
  }

  maybe(i: number): DocLine | null {
    return i < 0 || i >= this.length ? null : this.at(i);
  }

  fromAt(i: number): number {
    return this.#from[i];
  }

  toAt(i: number): number {
    return this.#to[i];
  }

  indexAt(pos: number): number {
    const from = this.#from;
    const to = this.#to;
    let lo = 0;
    let hi = this.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pos < from[mid]) hi = mid - 1;
      else if (pos > to[mid]) lo = mid + 1;
      else return mid;
    }
    return -1;
  }

  *[Symbol.iterator](): IterableIterator<DocLine> {
    for (let i = 0; i < this.length; i++) yield this.at(i);
  }
}

export const isBlankLine = (line: DocLine): boolean => line.to === line.from;

export const isDesignatorLine = (line: DocLine): boolean =>
  line.cls === "slot.v" || line.cls === "slot.c";

/**
 * Is this line's marker one that must start its line — a Paragraph or Header
 * marker in the engine's table (`\p`, `\m`, `\q1`, `\s1`, `\id`…), which is
 * every `block.*` class and a blank line (`mapping.ts`)? The engine flags one
 * that follows text directly (`marker-not-ws-preceded`), so the newline before
 * it is part of it. A `\v`, a `\c`, a milestone, a character marker or a note
 * may follow text directly, and the newline before one is only a line break.
 */
export const bindsToItsLine = (line: DocLine): boolean =>
  line.cls === "blank" || line.cls.startsWith("block.");

export const opensAParagraph = (line: DocLine): boolean =>
  line.marker !== null &&
  (line.cls === "block.para" || line.cls === "blank" || line.cls === "table");

export const paintsItsOwnLine = (line: DocLine): boolean => paintsItsOwnLineAmbient(line.cls);
