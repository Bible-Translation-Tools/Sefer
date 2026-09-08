/**
 * The small vocabulary every rule and command shares: the `trusted` annotation,
 * the mode and paint ports, and the per-line helpers that need no more than a
 * structure.
 *
 * It exists to break a cycle, and to state the trust rule once: an edit carrying
 * `trusted` came from a fix, a format, a project operation or the canonical text
 * coming back, and the keyboard guards do not apply to it.
 */

import {
  Annotation,
  EditorState,
  Facet,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";

import {
  isDesignatorLine,
  type Block,
  type BlockTable,
  type DocStructure,
  type DocLine,
} from "./docStructure";
import type { DocPlan } from "./plan";

export type GetStructure = (s: EditorState) => DocStructure;

export type GetPlan = (s: EditorState) => DocPlan;

export type ChangeRule = (tr: Transaction) => boolean | readonly number[];

export type TransactionRule = (tr: Transaction) => TransactionSpec | readonly TransactionSpec[];

export const trusted = Annotation.define<string>();

export const isTrusted = (tr: { annotation: (a: typeof trusted) => string | undefined }) =>
  tr.annotation(trusted) !== undefined;

export type Mode = "regular" | "usfm";

export const modeFacet = Facet.define<Mode, Mode>({ combine: (v) => v[0] ?? "regular" });

export const newlineIsABreak = Facet.define<boolean, boolean>({ combine: (v) => v[0] ?? false });

export const isVisual = (state: EditorState) => state.facet(modeFacet) === "regular";

export const lineAt = (s: DocStructure, state: EditorState, pos: number): DocLine | null =>
  s.lines.maybe(state.doc.lineAt(pos).number - 1);

export interface PaintPort {
  hidden: (state: EditorState, from: number, to: number) => boolean;
  draws: (state: EditorState, pos: number) => boolean;
  joined: (state: EditorState, pos: number) => boolean;
  atomic: (state: EditorState, l: DocLine) => readonly { from: number; to: number }[];
}

const NO_ATOMS: readonly { from: number; to: number }[] = [];

export const NO_PAINT: PaintPort = {
  hidden: () => false,
  draws: () => false,
  joined: () => false,
  atomic: () => NO_ATOMS,
};

export type ChromeRange = { from: number; to: number; lean: "fwd" | "back" };

export function chromeForCaret(l: DocLine): ChromeRange[] {
  const out: ChromeRange[] = [];
  if (l.marker) {
    if (isDesignatorLine(l)) {
      out.push({ from: l.from, to: l.markerEnd, lean: "fwd" });
    } else if (l.contentFrom > l.from) out.push({ from: l.from, to: l.contentFrom, lean: "fwd" });
  }
  for (const wd of l.words) {
    out.push({ from: wd.from, to: wd.surfaceFrom, lean: "fwd" });
    out.push({ from: wd.attrFrom, to: wd.to, lean: "back" });
  }
  return out.filter((c) => c.to > c.from);
}

export function nl(_state: EditorState) {
  return "\n";
}

export function blockAt(s: DocStructure, pos: number): Block | null {
  const blocks = s.blocks;
  for (let i = 0; i < blocks.length; i++)
    if (pos >= blocks.fromAt(i) && pos <= blocks.toAt(i)) return blocks.at(i);
  return null;
}

export function chromeEnd(l: DocLine): number {
  if (!l.marker) return l.from;
  if (isDesignatorLine(l)) return l.markerEnd;
  return l.contentFrom;
}

function aBlockOpensAt(blocks: BlockTable, pos: number): boolean {
  for (let i = 0; i < blocks.length; i++)
    if (blocks.contentFromAt(i) === pos && blocks.contentFromAt(i) > blocks.fromAt(i)) return true;
  return false;
}

export function atContentHead(s: DocStructure, state: EditorState, pos: number): boolean {
  const l = s.lines.maybe(state.doc.lineAt(pos).number - 1);
  const head =
    (l && l.marker && pos === l.contentFrom && l.contentFrom > l.from) ||
    aBlockOpensAt(s.blocks, pos);
  if (!head) return false;
  return pos > 0 && !/\s/.test(state.doc.sliceString(pos - 1, pos));
}
