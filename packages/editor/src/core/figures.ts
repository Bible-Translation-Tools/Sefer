import type { EditorState } from "@codemirror/state";
import { MARKERS, TOKEN, TOKEN_SPELLING_BIT } from "@sefer/text/engine/analysis";

import { forTokensIn } from "./decorations";
import { docText, structureAt } from "./docStructure";

/**
 * One figure, `\fig Caption|src="a.jpg" size="col" ref="1.5"\fig*`, as its
 * parts' spans. The DATA half of the figures feature (`recipes/figures.ts`):
 * a host can list a book's figures and draw them its own way. Its attributes
 * are read and written as any attributed markup's are (`attributesAt`).
 */
export interface Figure {
  /** The whole figure, `\fig` to `\fig*`. */
  readonly from: number;
  readonly to: number;
  /** The caption's words: `Caption`. Empty (`captionFrom === captionTo`) when there are none. */
  readonly captionFrom: number;
  readonly captionTo: number;
  /** The attribute list, `|` included; empty where one would go when there is none. */
  readonly listFrom: number;
  readonly listTo: number;
  /** The marker's catalogue row, for the attribute table. */
  readonly markerIdx: number;
}

const isFig = (markerIdx: number): boolean =>
  (MARKERS[markerIdx]?.name ?? "").replace(/^\+/, "") === "fig";

/** The figures that start in `[from, to)`, read off the parse's tokens. */
export function figuresIn(state: EditorState, from: number, to: number): Figure[] {
  const analysis = structureAt(state).analysis;
  if (analysis === null || analysis.text !== docText(state)) return [];
  const found: Figure[] = [];
  let open: {
    from: number;
    markerIdx: number;
    captionFrom: number;
    captionTo: number;
    listFrom: number;
    listTo: number;
  } | null = null;
  forTokensIn(analysis.dish.tokens.rows, { from, to }, (kindBits, markerIdx, a, b) => {
    const kind = kindBits & ~TOKEN_SPELLING_BIT;
    if (kind === TOKEN.MARKER && isFig(markerIdx)) {
      open = { from: a, markerIdx, captionFrom: b, captionTo: b, listFrom: -1, listTo: -1 };
      return;
    }
    if (open === null) return;
    if (kind === TOKEN.ATTR_LIST) {
      open.listFrom = a;
      open.listTo = b;
    } else if (kind === TOKEN.CLOSING_MARKER && isFig(markerIdx)) {
      const listFrom = open.listFrom < 0 ? a : open.listFrom;
      found.push({
        from: open.from,
        to: b,
        captionFrom: open.captionFrom,
        captionTo: Math.min(open.captionTo, listFrom),
        listFrom,
        listTo: open.listFrom < 0 ? a : open.listTo,
        markerIdx: open.markerIdx,
      });
      open = null;
    } else if (open.listFrom < 0) open.captionTo = b;
  });
  return found;
}

/** The figure whose span holds `pos`, or `null`. */
export const figureAt = (state: EditorState, pos: number): Figure | null => {
  const line = state.doc.lineAt(pos);
  return figuresIn(state, line.from, line.to + 1).find((f) => pos >= f.from && pos <= f.to) ?? null;
};
