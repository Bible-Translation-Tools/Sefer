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
} from "./model/docStructure";
import { isContainerClass } from "./model/registry";
import type { DocPlan } from "./paint/plan";

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

export const lineAt = (structure: DocStructure, state: EditorState, pos: number): DocLine | null =>
  structure.lines.maybe(state.doc.lineAt(pos).number - 1);

export interface PaintPort {
  hidden: (state: EditorState, from: number, to: number) => boolean;
  draws: (state: EditorState, pos: number) => boolean;
  joined: (state: EditorState, pos: number) => boolean;
  atomic: (state: EditorState, line: DocLine) => readonly { from: number; to: number }[];
}

const NO_ATOMS: readonly { from: number; to: number }[] = [];

export const NO_PAINT: PaintPort = {
  hidden: () => false,
  draws: () => false,
  joined: () => false,
  atomic: () => NO_ATOMS,
};

export type ChromeRange = { from: number; to: number; lean: "fwd" | "back" };

export function chromeForCaret(line: DocLine): ChromeRange[] {
  const out: ChromeRange[] = [];
  if (line.marker) {
    if (isDesignatorLine(line)) {
      out.push({ from: line.from, to: line.markerEnd, lean: "fwd" });
    } else if (line.contentFrom > line.from)
      out.push({ from: line.from, to: line.contentFrom, lean: "fwd" });
  }
  for (const wd of line.words) {
    out.push({ from: wd.from, to: wd.surfaceFrom, lean: "fwd" });
    out.push({ from: wd.attrFrom, to: wd.to, lean: "back" });
  }
  return out.filter((c) => c.to > c.from);
}

export function nl(_state: EditorState) {
  return "\n";
}

/** The block at `pos`: one inside a container before the container itself. */
export function blockAt(structure: DocStructure, pos: number): Block | null {
  const blocks = structure.blocks;
  let container: Block | null = null;
  for (let i = 0; i < blocks.length; i++) {
    if (pos < blocks.fromAt(i) || pos > blocks.toAt(i)) continue;
    if (!isContainerClass(blocks.clsAt(i))) return blocks.at(i);
    container ??= blocks.at(i);
  }
  return container;
}

export function chromeEnd(line: DocLine): number {
  if (!line.marker) return line.from;
  if (isDesignatorLine(line)) return line.markerEnd;
  return line.contentFrom;
}

function aBlockOpensAt(blocks: BlockTable, pos: number): boolean {
  for (let i = 0; i < blocks.length; i++)
    if (blocks.contentFromAt(i) === pos && blocks.contentFromAt(i) > blocks.fromAt(i)) return true;
  return false;
}

export function atContentHead(structure: DocStructure, state: EditorState, pos: number): boolean {
  const line = structure.lines.maybe(state.doc.lineAt(pos).number - 1);
  const head =
    (line && line.marker && pos === line.contentFrom && line.contentFrom > line.from) ||
    aBlockOpensAt(structure.blocks, pos);
  if (!head) return false;
  return pos > 0 && !/\s/.test(state.doc.sliceString(pos - 1, pos));
}
