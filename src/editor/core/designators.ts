/**
 * One lazy verse row: the `\v` designator's number, its delimiter, and the
 * extent of the verse it opens.
 *
 * A designator is the most protected thing on the page — the number IS the
 * address of the text — so its spans are stated once, here, and every rule that
 * guards it reads them rather than re-scanning the line.
 */

import type { VerseRow } from "./fold";

export class Verse implements VerseRow {
  readonly markerFrom: number;
  readonly markerTo: number;
  readonly numFrom: number;
  readonly numTo: number;
  readonly contentFrom: number;
  readonly #doc: string;
  #num: string | null | undefined = undefined;

  constructor(
    doc: string,
    markerFrom: number,
    markerTo: number,
    numFrom: number,
    numTo: number,
    contentFrom: number,
  ) {
    this.#doc = doc;
    this.markerFrom = markerFrom;
    this.markerTo = markerTo;
    this.numFrom = numFrom;
    this.numTo = numTo;
    this.contentFrom = contentFrom;
  }

  get num(): string | null {
    if (this.#num === undefined)
      this.#num = this.numTo > this.numFrom ? this.#doc.slice(this.numFrom, this.numTo) : null;
    return this.#num;
  }
}
