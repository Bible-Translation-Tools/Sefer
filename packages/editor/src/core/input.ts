import { EditorState, type SelectionRange, type StateCommand } from "@codemirror/state";

import { isDesignatorLine, opensAParagraph, type DocStructure } from "./docStructure";
import { blockKindForEnter, inDesignatorDelimiter } from "./exceptions";
import {
  type GetPlan,
  type GetStructure,
  atContentHead,
  blockAt,
  chromeEnd,
  isTrusted,
  isVisual,
  lineAt,
  newlineIsABreak,
  nl,
  trusted,
  type TransactionRule,
} from "./kernel";
import type { OwnedIndex } from "./owned";
import { note, noteTr, tracing } from "./trace";

function designatorAt(structure: DocStructure, pos: number): number | null {
  for (const v of structure.verses)
    if (v.num !== null && pos > v.numFrom && pos < v.numTo) return v.contentFrom;
  for (const l of structure.lines)
    if (isDesignatorLine(l) && l.num !== null && pos > l.numFrom && pos < l.numTo)
      return l.contentFrom;
  return null;
}

interface BreakPoint {
  at: number;
  above: boolean;
  travels: boolean;
  why: string;
}

function whereALineBreakMayLand(
  state: EditorState,
  structure: DocStructure,
  targets: OwnedIndex,
  sel: SelectionRange,
): BreakPoint {
  if (!sel.empty) return { at: sel.from, above: false, travels: false, why: "range" };

  const b = blockAt(structure, sel.from);
  if (b && sel.from === b.contentFrom && b.contentFrom > b.from)
    return { at: b.from, above: true, travels: true, why: "content-head" };

  const num = designatorAt(structure, sel.from);
  if (num) return { at: num, above: false, travels: false, why: "after-designator" };

  const line = structure.lines.maybe(state.doc.lineAt(sel.from).number - 1);
  const inside = line?.words.find((w) => sel.from > w.from && sel.from < w.to);
  if (inside) return { at: inside.to, above: false, travels: false, why: "after-wrapper" };

  const prev = targets.addressedBackward(sel.from);
  if (prev.kind === "box" && prev.at === sel.from && prev.target)
    return { at: prev.target.wholeSpan.from, above: true, travels: true, why: "box-travels" };

  const held = structure.lines.maybe(state.doc.lineAt(prev.at).number - 1);
  const straddled = held?.words.find((w) => prev.at > w.from && prev.at < w.to);
  const v = straddled ? straddled.from : prev.at;
  if (prev.kind !== "none" && v < sel.from) {
    const above = v === 0 || prev.kind === "break";
    let at = v;
    if (!above) {
      let u = v;
      while (u < sel.from && inDesignatorDelimiter(structure, u)) u++;
      if (u === sel.from && u > v) at = u;
    }
    return { at, above, travels: false, why: at === v ? "eject" : "eject-past-delimiter" };
  }

  return { at: sel.from, above: false, travels: false, why: "at-caret" };
}

export function guardedEnter(structureAt: GetStructure, plansAt: GetPlan): StateCommand {
  return (target) => {
    const { state, dispatch } = target;
    if (!isVisual(state)) return false;
    const sel = state.selection.main;
    if (tracing(state)) {
      const block = blockAt(structureAt(state), sel.from);
      const docLine = state.doc.lineAt(sel.from);
      note(state, {
        rule: "guardedEnter",
        verdict: "passed",
        detail:
          `at ${sel.from} L${docLine.number}:${sel.from - docLine.from}` +
          ` block=${block ? `${block.kind}[${block.from},${block.contentFrom},${block.to})` : "NONE"}` +
          ` ctx=${JSON.stringify(state.doc.sliceString(Math.max(0, sel.from - 12), sel.from) + "|" + state.doc.sliceString(sel.from, sel.from + 12))}`,
      });
    }
    if (!state.facet(newlineIsABreak)) {
      const structure = structureAt(state);
      const breakPoint = whereALineBreakMayLand(state, structure, plansAt(state).targets(), sel);
      const kind = blockKindForEnter(blockAt(structure, sel.from));
      const nlch = nl(state);
      const insert = breakPoint.above ? `\\${kind} ${nlch}` : `${nlch}\\${kind} `;
      const to = sel.empty ? breakPoint.at : sel.to;
      note(state, {
        rule: "guardedEnter",
        verdict: "rewrote",
        detail: `${breakPoint.why} — put [${breakPoint.at}${to === breakPoint.at ? "" : `,${to}`}]=${JSON.stringify(insert)}`,
      });
      dispatch(
        state.update({
          changes: { from: breakPoint.at, to, insert },
          selection: {
            anchor: breakPoint.travels
              ? sel.from + insert.length
              : breakPoint.at + insert.length - (breakPoint.above ? nlch.length : 0),
          },
          userEvent: breakPoint.travels ? "input.usfm.paragraphAbove" : "input.usfm.paragraph",
          scrollIntoView: true,
        }),
      );
      return true;
    }
    const s = structureAt(state);
    const line = lineAt(s, state, sel.from);
    const insert = nl(state);
    if (
      line &&
      line.marker &&
      sel.empty &&
      sel.from === chromeEnd(line) &&
      line.contentFrom > line.from
    ) {
      note(state, {
        rule: "guardedEnter",
        verdict: "rewrote",
        detail: `line-above — put [${line.from}]=${JSON.stringify(insert)}`,
      });
      dispatch(
        state.update({
          changes: { from: line.from, insert },
          selection: { anchor: line.from + insert.length },
          userEvent: "input.usfm.lineAbove",
          scrollIntoView: true,
        }),
      );
      return true;
    }
    note(state, {
      rule: "guardedEnter",
      verdict: "rewrote",
      detail: `plain — put [${sel.from},${sel.to}]=${JSON.stringify(insert)}`,
    });
    dispatch(
      state.update({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: sel.from + insert.length },
        userEvent: "input",
        scrollIntoView: true,
      }),
    );
    return true;
  };
}

export function keepPoetryMarkersAtTheStartOfTheirLine(structureAt: GetStructure): TransactionRule {
  return (tr) => {
    if (!tr.docChanged || !isVisual(tr.startState) || isTrusted(tr)) return tr;
    const structure = structureAt(tr.startState);
    const blocks = structure.blocks;
    const firstBlockAtOrAfter = (pos: number): number => {
      let lo = 0;
      let hi = blocks.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (blocks.fromAt(mid) < pos) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const adds: { from: number; insert: string }[] = [];
    let done = -1;
    tr.changes.iterChangedRanges((fromA, toA) => {
      for (
        let i = Math.max(done + 1, firstBlockAtOrAfter(fromA));
        i < blocks.length && blocks.fromAt(i) <= toA;
        i++
      ) {
        done = i;
        const from = blocks.fromAt(i);
        if (!blocks.poetryAt(i) || from === 0) continue;
        if (tr.startState.doc.sliceString(from - 1, from) !== "\n") continue;
        const mapped = tr.changes.mapPos(from, 1);
        if (
          mapped > 0 &&
          tr.newDoc.sliceString(mapped, mapped + 1) === "\\" &&
          tr.newDoc.sliceString(mapped - 1, mapped) !== "\n"
        )
          adds.push({ from: mapped, insert: "\n" });
      }
    });
    if (!adds.length) return tr;
    noteTr(tr, {
      rule: "keepPoetryMarkersAtTheStartOfTheirLine",
      verdict: "rewrote",
      detail: `restored ${adds.length} line start(s) a poetry marker needs`,
    });
    return [tr, { changes: adds, sequential: true }];
  };
}

export function refuseMarkupPastedInsideAWord(
  structureAt: GetStructure,
  marksUp: (doc: string, from: number, to: number) => boolean,
): TransactionRule {
  return (tr) => {
    if (!tr.docChanged || isTrusted(tr) || !isVisual(tr.startState)) return tr;
    if (!tr.isUserEvent("input.paste")) return tr;
    const structure = structureAt(tr.startState);
    let veto = false;
    const after = tr.newDoc.toString();
    tr.changes.iterChanges((fromA, _tA, fromB, toB, ins) => {
      if (veto || !ins.length) return;
      const line = structure.lines.maybe(tr.startState.doc.lineAt(fromA).number - 1);
      if (!line?.words.some((w) => fromA > w.from && fromA < w.to)) return;
      if (marksUp(after, fromB, toB)) veto = true;
    });
    if (!veto) return tr;
    noteTr(tr, {
      rule: "refuseMarkupPastedInsideAWord",
      verdict: "refused",
      detail: "the paste lexes as markup strictly inside a word",
    });
    return [];
  };
}

export function refusePastesThatWouldAddAChapter(
  structureAt: GetStructure,
  chapterCount: (doc: string) => number,
): TransactionRule {
  return (tr) => {
    if (!tr.docChanged || isTrusted(tr) || !isVisual(tr.startState)) return tr;
    if (!tr.isUserEvent("input.paste") && !tr.isUserEvent("input.drop")) return tr;
    let hasSigil = false;
    tr.changes.iterChanges((_fA, _tA, _fB, _tB, ins) => {
      if (ins.length && ins.toString().includes("\\")) hasSigil = true;
    });
    if (!hasSigil) return tr;
    const before = structureAt(tr.startState).chapters.length;
    const after = chapterCount(tr.newDoc.toString());
    if (after <= before) return tr;
    noteTr(tr, {
      rule: "refusePastesThatWouldAddAChapter",
      verdict: "refused",
      detail: `the paste would take chapters ${before} → ${after}`,
    });
    return [];
  };
}

export function refuseATypedBackslash(): TransactionRule {
  return (tr) => {
    if (!tr.docChanged || isTrusted(tr) || !isVisual(tr.startState)) return tr;
    if (!tr.isUserEvent("input.type")) return tr;
    let sigil = false;
    let other = false;
    tr.changes.iterChanges((_fA, _tA, _fB, _tB, ins) => {
      const text = ins.toString();
      if (text === "\\") sigil = true;
      else if (text.length) other = true;
    });
    if (!sigil || other) return tr;
    noteTr(tr, {
      rule: "refuseATypedBackslash",
      verdict: "refused",
      detail: "a typed backslash is markup, not text",
    });
    return [];
  };
}

export function supplyTheDelimiterAMarkerIsMissing(structureAt: GetStructure): TransactionRule {
  return (tr) => {
    if (!tr.docChanged || isTrusted(tr) || !isVisual(tr.startState)) return tr;
    if (!tr.isUserEvent("input")) return tr;
    const structure = structureAt(tr.startState);
    let fix: number | null = null;
    tr.changes.iterChanges((fromA, toA, _fB, _tB, ins) => {
      if (fix || fromA !== toA || !ins.length) return;
      if (!atContentHead(structure, tr.startState, fromA)) return;
      if (!/^\S/.test(ins.toString())) return;
      fix = fromA;
    });
    if (fix === null) return tr;
    noteTr(tr, {
      rule: "supplyTheDelimiterAMarkerIsMissing",
      verdict: "rewrote",
      detail: `supplied the delimiter a marker lacked, at ${fix}`,
    });
    return [
      tr,
      {
        changes: { from: fix, insert: " " },
        sequential: true,
        annotations: trusted.of("supply-delimiter"),
      },
    ];
  };
}

export function setBlockMarker(structureAt: GetStructure, marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const structure = structureAt(state);
    const b = blockAt(structure, state.selection.main.from);
    if (!b) return false;
    const head = b.lines[0];
    const changes = opensAParagraph(head)
      ? { from: head.from, to: head.contentFrom, insert: `\\${marker} ` }
      : { from: head.from, to: head.from, insert: `\\${marker}${nl(state)}` };
    dispatch(state.update({ changes, userEvent: "input.usfm.reparent", scrollIntoView: true }));
    return true;
  };
}
