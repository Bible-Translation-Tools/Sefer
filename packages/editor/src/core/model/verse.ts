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
