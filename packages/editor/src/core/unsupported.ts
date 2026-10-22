import type { EditorState } from "@codemirror/state";
import { MARKERS, TOKEN, TOKEN_SPELLING_BIT } from "@sefer/text/engine/analysis";

import { forTokensIn } from "./decorations";
import { docText, structureAt } from "./docStructure";
import { decoField } from "./editorState";
import { isVisual } from "./kernel";

/**
 * Markup Reading has no drawing for yet: a marker, closer or attribute list
 * that no decoration hides or replaces, so it would show as raw USFM. The
 * DATA half of the chips (`recipes/markupChips.ts`): a host can read it and
 * draw it its own way.
 */
export interface UnsupportedMarkup {
  readonly from: number;
  readonly to: number;
  /** The marker as spelled, no backslash or `*`: `tr`, `fig`; `null` for an attribute list. */
  readonly marker: string | null;
  /** A closer (`\fig*`) rather than an opener. */
  readonly closing: boolean;
  /** What a reader calls it: "table row", "figure", "page break". */
  readonly label: string;
  /** The raw text it stands for. */
  readonly text: string;
}

const LABELS: Readonly<Record<string, string>> = {
  tr: "table row",
  th: "heading cell",
  thc: "heading cell",
  thr: "heading cell",
  tc: "cell",
  tcc: "cell",
  tcr: "cell",
  fig: "figure",
  esb: "sidebar",
  esbe: "sidebar end",
  cat: "category",
  pb: "page break",
  cp: "published chapter",
  periph: "peripheral",
};

const SHOWN_KINDS = new Set<number>([TOKEN.MARKER, TOKEN.CLOSING_MARKER, TOKEN.ATTR_LIST]);

const labelOf = (marker: string | null, closing: boolean): string => {
  if (marker === null) return "attributes";
  const base = marker.replace(/\d+$/, "");
  const label = LABELS[base] ?? LABELS[marker] ?? marker;
  return closing ? `${label} end` : label;
};

/**
 * The unsupported markup in `[from, to)`: in Reading only, and only where the
 * editor's own decorations leave a marker showing. A marker the editor draws
 * (a verse number, a heading's marker, a milestone) is never one.
 */
export function unsupportedMarkup(
  state: EditorState,
  from: number,
  to: number,
): UnsupportedMarkup[] {
  if (!isVisual(state)) return [];
  const analysis = structureAt(state).analysis;
  const doc = docText(state);
  if (analysis === null || analysis.text !== doc) return [];
  const drawn = state.field(decoField, false)?.set;
  const covered = (a: number, b: number): boolean => {
    let hit = false;
    drawn?.between(a, b, (f, t, deco) => {
      if (deco.point && f <= a && t >= b) hit = true;
      return hit ? false : undefined;
    });
    return hit;
  };
  const found: UnsupportedMarkup[] = [];
  forTokensIn(analysis.dish.tokens.rows, { from, to }, (kindBits, markerIdx, a, b) => {
    const kind = kindBits & ~TOKEN_SPELLING_BIT;
    if (!SHOWN_KINDS.has(kind) || b <= from || a >= to || b <= a || covered(a, b)) return;
    const closing = kind === TOKEN.CLOSING_MARKER;
    const marker =
      kind === TOKEN.ATTR_LIST ? null : (MARKERS[markerIdx]?.name ?? "").replace(/^\+/, "") || null;
    found.push({
      from: a,
      to: b,
      marker,
      closing,
      label: labelOf(marker, closing),
      text: doc.slice(a, b),
    });
  });
  return found;
}
