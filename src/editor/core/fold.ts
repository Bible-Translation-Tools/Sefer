/**
 * The row vocabulary of the fold: what a line, block, chapter, verse, note and
 * word ARE, as interfaces, plus the mutable `Fold` scratch record the builders
 * fill in.
 *
 * Types only (and one throw). It exists so `docStructure.ts` can build the
 * typed-array columns while `lineTable.ts`, `blockTable.ts`, `notes.ts` and
 * `designators.ts` each own one lazy row class over them — the tables are the
 * data, these are the shapes a reader sees.
 */

import type { NotePart } from "../../core/galley";
import type { CstScan } from "./cst";
import type { ClassKey } from "./registry";

export interface DocLine {
  readonly n: number;
  readonly from: number;
  readonly to: number;
  readonly cls: ClassKey;
  readonly marker: string | null;
  readonly contentFrom: number;
  readonly markerEnd: number;
  readonly numFrom: number;
  readonly numTo: number;
  readonly num: string | null;
  readonly notes: NoteRange[];
  readonly words: WordRange[];
  readonly milestones: { from: number; to: number; name: string }[];
  readonly breaks: { from: number; to: number }[];
}

export interface NoteRange {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  readonly parts: NotePart[];
}

export interface WordRange {
  from: number;
  to: number;
  marker: number;
  surfaceFrom: number;
  surfaceTo: number;
  attrFrom: number;
  attrTo: number;
}

export interface Block {
  readonly kind: string;
  readonly cls: ClassKey;
  readonly poetry: boolean;
  readonly lines: DocLine[];
  readonly head: number;
  readonly last: number;
  readonly from: number;
  readonly contentFrom: number;
  to: number;
}

export interface ChapterRow {
  ordinal: number;
  label: string;
  labelFrom: number;
  labelTo: number;
  from: number;
  to: number;
  line: number;
  lastLine: number;
}

export interface VerseRow {
  markerFrom: number;
  markerTo: number;
  numFrom: number;
  numTo: number;
  num: string | null;
  contentFrom: number;
}

export interface LineTable extends Iterable<DocLine> {
  readonly length: number;
  at(i: number): DocLine;
  maybe(i: number): DocLine | null;
  fromAt(i: number): number;
  toAt(i: number): number;
  indexAt(pos: number): number;
}

export interface BlockTable extends Iterable<Block> {
  readonly length: number;
  at(i: number): Block;
  fromAt(i: number): number;
  toAt(i: number): number;
  contentFromAt(i: number): number;
  lastAt(i: number): number;
  clsAt(i: number): ClassKey;
  poetryAt(i: number): boolean;
}

export interface Fold {
  doc: string;
  cst: CstScan;
  clip: { from: number; to: number } | null;
  lines: LineTable;
  contentAfter: (markerRow: number) => number;
  chapterOfToken: Int32Array;
  verseOfToken: Int32Array;
  chapters: ChapterRow[];
  verses: VerseRow[];
  notesByLine: Map<number, NoteRange[]>;
  wordsByLine: Map<number, WordRange[]>;
}

export const noRow = (i: number): never => {
  throw new RangeError(`row ${i} is off the end of an empty fold`);
};
