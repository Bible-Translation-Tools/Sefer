import { type EditorState, Facet } from "@codemirror/state";

import { docText, structureAt } from "./docStructure";

/**
 * One figure, `\fig Caption|src="a.jpg" size="col" ref="1.5"\fig*`, as its
 * parts' spans: the structure's `WordRange` for it (`figure: true`), named for
 * what a host wants. The registry's `figure` class draws it; this is the data
 * a host reads to list a book's figures or draw them its own way. Its
 * attributes are read and written as any attributed markup's (`attributesAt`).
 */
export interface Figure {
  /** The whole figure, `\fig` to `\fig*`. */
  readonly from: number;
  readonly to: number;
  /** The caption's words. Empty (`captionFrom === captionTo`) when there are none. */
  readonly captionFrom: number;
  readonly captionTo: number;
  /** The attribute list, `|` included; empty where one would go when there is none. */
  readonly listFrom: number;
  readonly listTo: number;
  /** The marker's catalogue row, for the attribute table. */
  readonly markerIdx: number;
}

/**
 * Where a figure's picture is, from its `src`: a URL to show, or `undefined`
 * for none, when the figure draws a frame. The host's (`figures({ resolveSource })`);
 * none by default.
 */
export const figureSource = Facet.define<
  (src: string) => string | undefined,
  ((src: string) => string | undefined) | null
>({ combine: (values) => values[0] ?? null });

/** The figures that overlap `[from, to)`. */
export function figuresIn(state: EditorState, from: number, to: number): Figure[] {
  const structure = structureAt(state);
  if (structure.analysis === null || structure.analysis.text !== docText(state)) return [];
  return structure.words
    .filter((w) => w.figure && w.to > from && w.from < to)
    .map((w) => ({
      from: w.from,
      to: w.to,
      captionFrom: w.surfaceFrom,
      captionTo: w.surfaceTo,
      listFrom: w.attrFrom,
      listTo: w.attrTo,
      markerIdx: w.marker,
    }));
}

/** The figure whose span holds `pos`, or `null`. */
export const figureAt = (state: EditorState, pos: number): Figure | null =>
  figuresIn(state, pos, pos + 1).find((f) => pos >= f.from && pos <= f.to) ?? null;
