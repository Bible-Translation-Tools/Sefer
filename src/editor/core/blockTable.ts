/**
 * The block table: paragraph-level spans, one lazy `Block` per row.
 *
 * A block is what a `\p`, `\q1` or `\s1` opens and the next block-opener
 * closes — the unit reflow, folding and Enter all reason about. Same shape as
 * the line table and for the same reason: typed-array columns, lazy rows.
 */

import { MARKERS } from "#core/galley";

import { spellingAt } from "./cst";
import { type Block, type BlockTable, type DocLine, type Fold, noRow } from "./fold";
import type { ClassKey } from "./registry";

export const NO_BLOCKS: BlockTable = {
  length: 0,
  at: noRow,
  fromAt: noRow,
  toAt: noRow,
  contentFromAt: noRow,
  lastAt: noRow,
  clsAt: noRow,
  poetryAt: noRow,
  *[Symbol.iterator]() {},
};

export interface BlockColumns {
  from: Int32Array;
  contentFrom: Int32Array;
  to: Int32Array;
  head: Int32Array;
  last: Int32Array;
  markerIdx: Int32Array;
  opener: Int32Array;
  poetry: Uint8Array;
  cls: ClassKey[];
}

class BlockSpan implements Block {
  readonly cls: ClassKey;
  readonly poetry: boolean;
  readonly from: number;
  readonly contentFrom: number;
  readonly head: number;
  readonly last: number;
  to: number;
  readonly #f: Fold;
  readonly #markerIdx: number;
  readonly #opener: number;
  #kind: string | null = null;
  #lines: DocLine[] | null = null;

  constructor(
    f: Fold,
    markerIdx: number,
    opener: number,
    cls: ClassKey,
    poetry: boolean,
    from: number,
    contentFrom: number,
    to: number,
    headLine: number,
    lastLine: number,
  ) {
    this.#f = f;
    this.#markerIdx = markerIdx;
    this.#opener = opener;
    this.cls = cls;
    this.poetry = poetry;
    this.from = from;
    this.contentFrom = contentFrom;
    this.to = to;
    this.head = headLine;
    this.last = lastLine;
  }

  get kind(): string {
    if (this.#kind === null) {
      const cst = this.#f.cst;
      const named = this.#markerIdx === 0 ? null : (MARKERS[this.#markerIdx]?.name ?? null);
      this.#kind = this.#opener >= 0 ? spellingAt(cst, this.#opener, this.#f.doc) : (named ?? "p");
    }
    return this.#kind;
  }

  get lines(): DocLine[] {
    if (this.#lines === null) {
      const table = this.#f.lines;
      const out: DocLine[] = [];
      for (let i = this.head - 1; i < this.last; i++) out[i - this.head + 1] = table.at(i);
      this.#lines = out;
    }
    return this.#lines;
  }
}

export class Blocks implements BlockTable {
  readonly length: number;
  readonly #f: Fold;
  readonly #c: BlockColumns;
  #memo: (BlockSpan | undefined)[] | null = null;

  constructor(f: Fold, c: BlockColumns, count: number) {
    this.#f = f;
    this.#c = c;
    this.length = count;
  }

  at(i: number): Block {
    if (i < 0 || i >= this.length) throw new RangeError(`block row ${i} of ${this.length}`);
    const memo = (this.#memo ??= Array.from<BlockSpan | undefined>({ length: this.length }));
    const held = memo[i];
    if (held) return held;
    const c = this.#c;
    const made = new BlockSpan(
      this.#f,
      c.markerIdx[i],
      c.opener[i],
      c.cls[i],
      c.poetry[i] === 1,
      c.from[i],
      c.contentFrom[i],
      c.to[i],
      c.head[i],
      c.last[i],
    );
    memo[i] = made;
    return made;
  }

  fromAt(i: number): number {
    return this.#c.from[i];
  }

  toAt(i: number): number {
    return this.#c.to[i];
  }

  contentFromAt(i: number): number {
    return this.#c.contentFrom[i];
  }

  lastAt(i: number): number {
    return this.#c.last[i];
  }

  clsAt(i: number): ClassKey {
    return this.#c.cls[i];
  }

  poetryAt(i: number): boolean {
    return this.#c.poetry[i] === 1;
  }

  *[Symbol.iterator](): IterableIterator<Block> {
    for (let i = 0; i < this.length; i++) yield this.at(i);
  }
}
