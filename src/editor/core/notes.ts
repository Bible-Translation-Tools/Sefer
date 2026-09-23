/**
 * One lazy note row: caller, origin, body and markup spans of a footnote or
 * cross reference, resolved from the CST on first read.
 *
 * Notes are the one structure whose parts a reader addresses separately (the
 * caller is a widget, the body is a satellite's whole content), which is why
 * they get a row class of their own rather than a span pair.
 */

import type { NodeView, NotePart } from "#core/galley";

import { notePartsOf } from "./cst";
import type { NoteRange } from "./fold";
import type { TokenShape } from "./mapping";

export class Note implements NoteRange {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  readonly #node: NodeView;
  readonly #shapeAt: (i: number) => TokenShape;
  #parts: NotePart[] | null = null;

  constructor(
    node: NodeView,
    from: number,
    to: number,
    kind: string,
    shapeAt: (i: number) => TokenShape,
  ) {
    this.#node = node;
    this.from = from;
    this.to = to;
    this.kind = kind;
    this.#shapeAt = shapeAt;
  }

  get parts(): NotePart[] {
    this.#parts ??= notePartsOf(this.#node, this.to, this.#shapeAt);
    return this.#parts;
  }
}
