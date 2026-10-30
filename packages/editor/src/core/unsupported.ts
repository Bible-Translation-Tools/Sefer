import { type EditorState, Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { isVisual } from "./kernel";
import { docText, lineIndexAt, structureAt } from "./model/docStructure";
import { markerWords } from "./words";

/**
 * Markup with no class of its own yet, the registry's `unruled` class: a
 * table's cell markers, `\pb`, `\cat`, a stray closer or attribute list. One
 * point each, a chip, deleted whole, edited in USFM mode. The DATA half: a
 * host can read it and draw it its own way.
 */
export interface UnsupportedMarkup {
  readonly from: number;
  readonly to: number;
  /** The marker as spelled, no backslash or `*`: `tr`, `fig`; `null` for an attribute list. */
  readonly marker: string | null;
  /** A closer (`\cat*`) rather than an opener. */
  readonly closing: boolean;
  /** What a reader calls it, in the host's words (`EditorWords.marker`) or English: "table row". */
  readonly label: string;
  /** The raw text it stands for. */
  readonly text: string;
}

/** How a chip is drawn. Without one (`markupChips` installs a richer one) it is a plain label. */
export type ChipRenderer = (markup: UnsupportedMarkup, view: EditorView) => HTMLElement;

export const chipRenderer = Facet.define<ChipRenderer, ChipRenderer | null>({
  combine: (values) => values[0] ?? null,
});

const SPELLED = /^\\(\+?)([A-Za-z][\w-]*)(\*)?/;

/** One `unruled` span as a reader's markup: its marker, whether it closes, its label. */
export function markupOf(
  state: EditorState,
  from: number,
  to: number,
  text: string = docText(state).slice(from, to),
): UnsupportedMarkup {
  const spelled = SPELLED.exec(text);
  const marker = spelled === null ? null : (spelled[2] ?? null);
  const closing = spelled?.[3] === "*";
  return { from, to, marker, closing, label: markerWords(state, marker, closing), text };
}

/** The unsupported markup in `[from, to)`, in Reading only: the plan's `unruled` marks. */
export function unsupportedMarkup(
  state: EditorState,
  from: number,
  to: number,
): UnsupportedMarkup[] {
  if (!isVisual(state)) return [];
  const structure = structureAt(state);
  const found: UnsupportedMarkup[] = [];
  const first = Math.max(0, lineIndexAt(structure, from));
  for (let i = first; i < structure.lines.length; i++) {
    const line = structure.lines.at(i);
    if (line.from > to) break;
    for (const span of line.unruled)
      if (span.to > from && span.from < to) found.push(markupOf(state, span.from, span.to));
  }
  return found;
}
