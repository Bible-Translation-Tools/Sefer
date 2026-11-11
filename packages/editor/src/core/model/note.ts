import type { NodeView } from "@wycliffeassociates/sefer-text/engine/analysis";

import { notePartsOf } from "./cst";
import type { NoteRange, NoteSpan } from "./fold";
import type { TokenShape } from "./mapping";

export class Note implements NoteRange {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  readonly #node: NodeView;
  readonly #shapeAt: (i: number) => TokenShape;
  #parts: NoteSpan[] | null = null;

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

  get parts(): NoteSpan[] {
    this.#parts ??= notePartsOf(this.#node, this.to, this.#shapeAt);
    return this.#parts;
  }
}
