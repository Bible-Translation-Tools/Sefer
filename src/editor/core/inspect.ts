/**
 * The read-only explainer: everything the editor knows about the position the
 * caret is in, as one flat record.
 *
 * For a probe page, a bug report and an agent reading the running app. It
 * computes nothing the editor does not already hold and it never dispatches.
 */

import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { backspaceAt, type Verdict } from "./deletion";
import { isDesignatorLine, type DocLine } from "./docStructure";
import { blockKindForEnter } from "./exceptions";
import {
  type GetPlan,
  type GetStructure,
  blockAt,
  chromeEnd,
  isVisual,
  newlineIsABreak,
} from "./kernel";

function hasContent(l: DocLine, state: EditorState): boolean {
  if (isDesignatorLine(l)) return l.num !== null;
  return state.doc.sliceString(chromeEnd(l), l.to).trim().length > 0;
}

const usfmScrollTo = (pos: number) => EditorView.scrollIntoView(pos, { y: "center" });

const show = (s: string) =>
  s === "" ? "∅" : s.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");

export interface CaretInfo {
  pos: number;
  anchor: number;
  selLen: number;
  line: number;
  col: number;
  before: string;
  after: string;
  lineClass: string;
  marker: string | null;
  num: string | null;
  numRange: [number, number] | null;
  contentFrom: number;
  chromeEnd: number;
  atChromeEnd: boolean;
  hasContent: boolean;
  inNote: boolean;
  inWord: boolean;
  backspace: string;
  enter: string;
}

function inspect(state: EditorState, structureAt: GetStructure, plansAt: GetPlan): CaretInfo {
  const s = structureAt(state);
  const sel = state.selection.main;
  const pos = sel.head;
  const docLine = state.doc.lineAt(pos);
  const l = s.lines.maybe(docLine.number - 1);
  const ce = l ? chromeEnd(l) : pos;
  const content = l ? hasContent(l, state) : true;

  const said = (v: Verdict): string => {
    if (v.act === "nothing") return "consumed — nothing goes";
    if (v.act === "consume") return "consumed — the caret makes the QoL move past an immortal";
    if (v.act === "default") return "delete one character";
    const cut = state.doc.sliceString(v.from, v.to);
    return `${v.say} — ${v.to - v.from} byte(s) ${JSON.stringify(cut)}`;
  };
  const backspace = !sel.empty
    ? `delete the selection (${sel.to - sel.from} chars)`
    : isVisual(state)
      ? said(backspaceAt(plansAt(state).targets(), pos))
      : "delete one character";

  let enter = "insert a newline here";
  if (!state.facet(newlineIsABreak)) {
    const b = blockAt(s, pos);
    const kind = blockKindForEnter(b);
    enter =
      b && sel.empty && pos === b.contentFrom && b.contentFrom > b.from
        ? `open a \\${kind} paragraph ABOVE this block — a break here would split it`
        : `open a paragraph (\\${kind}) — a bare newline renders as nothing here`;
  } else if (l && l.marker && sel.empty && pos === ce && l.contentFrom > l.from)
    enter = `insert the newline ABOVE the \\${l.marker} line`;

  return {
    pos,
    anchor: sel.anchor,
    selLen: sel.to - sel.from,
    line: docLine.number,
    col: pos - docLine.from,
    before: show(state.doc.sliceString(Math.max(0, pos - 8), pos)),
    after: show(state.doc.sliceString(pos, Math.min(state.doc.length, pos + 8))),
    lineClass: l?.cls ?? "?",
    marker: l?.marker ?? null,
    num: l?.num ?? null,
    numRange: l && l.num !== null ? [l.numFrom, l.numTo] : null,
    contentFrom: l?.contentFrom ?? pos,
    chromeEnd: ce,
    atChromeEnd: pos === ce,
    hasContent: content,
    inNote: !!l?.notes.some((n) => pos > n.from && pos < n.to),
    inWord: !!l?.words.some((wd) => pos > wd.from && pos < wd.to),
    backspace,
    enter,
  };
}
