/**
 * The line table: one lazy `DocLine` per document line, over the columns
 * `buildStructure` filled.
 *
 * Rows are built on demand and memoized, because a chapter of Psalms is a few
 * hundred lines and a keystroke reads three of them. Also holds the small
 * predicates every consumer asks of a line — is it blank, does it open a
 * paragraph, does it paint its own line.
 */

import { TOKEN } from "#core/galley";

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
const NO_BREAKS: { from: number; to: number }[] = [];

export const NO_LINES: LineTable = {
  length: 0,
  at: noRow,
  maybe: () => null,
  fromAt: noRow,
  toAt: noRow,
  indexAt: () => -1,
  *[Symbol.iterator]() {},
};

function openerOfLine(f: Fold, from: number, to: number): number {
  const cst = f.cst;
  const { startAt, endAt, kindAt } = cst;
  for (let i = cst.tokenAt(from); i < cst.count && startAt[i] <= to; i++) {
    if (kindAt[i] === TOKEN.NEWLINE) return -1;
    if (endAt[i] <= startAt[i]) continue;
    if (cst.isBlank(i)) continue;
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

  constructor(f: Fold, n: number, from: number, to: number) {
    this.#f = f;
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
        if (this.#milestones === NO_MILESTONES) this.#milestones = [];
        this.#milestones.push({ from, to: cst.payloadEnd(i), name: spellingAt(cst, i, f.doc) });
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
  get milestones(): { from: number; to: number; name: string }[] {
    this.#walk();
    return this.#milestones;
  }
  get breaks(): { from: number; to: number }[] {
    this.#walk();
    return this.#breaks;
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

  constructor(f: Fold, from: Uint32Array, to: Uint32Array, count: number) {
    this.#f = f;
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

export const isBlankLine = (l: DocLine): boolean => l.to === l.from;

export const isDesignatorLine = (l: DocLine): boolean => l.cls === "slot.v" || l.cls === "slot.c";

export const opensAParagraph = (l: DocLine): boolean =>
  l.marker !== null && (l.cls === "block.para" || l.cls === "blank");

export const paintsItsOwnLine = (l: DocLine): boolean => paintsItsOwnLineAmbient(l.cls);
