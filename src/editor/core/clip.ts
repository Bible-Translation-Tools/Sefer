/**
 * The clip: which chapter is visible and which part of it is editable, plus the
 * two rules that enforce it.
 *
 * A clip is Sefer's answer to "one chapter at a time" — the editor holds the
 * WHOLE book, and the clip hides and protects everything outside the picked
 * chapter. Admission refuses edits outside it; settlement pulls a stray
 * selection back in. Both read the same extents, so what is guarded and what is
 * shown cannot drift apart.
 *
 * The two rules take the range as a function, and the chapter clip is only one
 * of their callers: a satellite's range (`recipes/satellite.ts`) is guarded by
 * the same pair. The difference is trust. The chapter clip is the canonical
 * editor's view choice, so a trusted edit (a fix, the front matter card) may
 * write outside it; a satellite's range is what that surface IS, so nothing
 * waives it — `{ trustWaives: false }`.
 */

import { EditorState, MapMode, StateEffect, StateField, type Text } from "@codemirror/state";

import { type ChapterRow, type DocStructure, structureField } from "./docStructure";
import { isTrusted, type ChangeRule, type TransactionRule } from "./kernel";
import { note, noteTr } from "./trace";

export function chapterContaining(chapters: readonly ChapterRow[], pos: number): ChapterRow | null {
  let found: ChapterRow | null = null;
  for (const c of chapters) {
    if (c.from > pos) break;
    found = c;
  }
  return found;
}

export const setPick = StateEffect.define<number | null>();

export const anchorFrom = (ch: ChapterRow) => (ch.label ? ch.labelFrom : ch.from);

export const pickField = StateField.define<number | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setPick)) return e.value;
    if (v === null || !tr.docChanged) return v;
    return tr.changes.mapPos(v, 1, MapMode.TrackDel);
  },
});

function resolvePick(s: DocStructure, doc: Text, at: number | null): ChapterRow | null {
  if (at === null) return null;
  return chapterContaining(s.chapters, Math.max(0, Math.min(at, doc.length)));
}

export type ClipRange = { from: number; to: number } | null;

function pickedChapter(st: EditorState): ChapterRow | null {
  const s = st.field(structureField, false);
  return s ? resolvePick(s, st.doc, st.field(pickField, false) ?? null) : null;
}

interface Extents {
  visible: { from: number; to: number };
  editable: { from: number; to: number };
}

function chapterExtents(ch: ChapterRow, doc: Text): Extents {
  const to = Math.min(ch.to, doc.length);
  const visible = { from: ch.from, to };
  if (!ch.label) return { visible, editable: visible };
  const marker = doc.lineAt(Math.min(ch.labelTo, doc.length));
  const after = marker.number < doc.lines ? doc.line(marker.number + 1).from : to;
  return { visible, editable: { from: Math.max(ch.from, Math.min(after, to)), to } };
}

export function editableClipAt(st: EditorState): ClipRange {
  const ch = pickedChapter(st);
  return ch ? chapterExtents(ch, st.doc).editable : null;
}

export function visibleClipAt(st: EditorState): ClipRange {
  const ch = pickedChapter(st);
  return ch ? chapterExtents(ch, st.doc).visible : null;
}

/** Whether a `trusted` edit may pass a range rule. The chapter clip: yes. */
export interface RangeRuleOptions {
  readonly trustWaives?: boolean;
}

export function refuseEditsOutsideTheClip(
  getRange: (state: EditorState) => { from: number; to: number } | null,
  { trustWaives = true }: RangeRuleOptions = {},
): ChangeRule {
  return (tr) => {
    if (trustWaives && isTrusted(tr)) return true;
    const r = getRange(tr.startState);
    if (!r) return true;
    const len = tr.startState.doc.length;
    const out: number[] = [];
    if (r.from > 0) out.push(0, r.from);
    if (r.to < len) out.push(r.to, len);
    if (!out.length) return true;
    note(tr.startState, {
      rule: "refuseEditsOutsideTheClip",
      verdict: "passed",
      detail: `guarding everything outside the clip [${r.from},${r.to})`,
    });
    return out;
  };
}

export function pullSelectionsIntoTheClip(
  getRange: (state: EditorState) => { from: number; to: number } | null,
  { trustWaives = true }: RangeRuleOptions = {},
): TransactionRule {
  return (tr) => {
    if (!tr.selection || (trustWaives && isTrusted(tr))) return tr;
    const win = getRange(tr.state);
    if (!win) return tr;
    let hi = win.to;
    if (win.to < tr.state.doc.length)
      while (hi > win.from && /[\r\n]/.test(tr.state.doc.sliceString(hi - 1, hi))) hi--;
    const fit = (p: number) => Math.max(win.from, Math.min(hi, p));
    const sel = tr.selection.main;
    const anchor = fit(sel.anchor);
    const head = fit(sel.head);
    if (anchor === sel.anchor && head === sel.head) return tr;
    noteTr(tr, {
      rule: "pullSelectionsIntoTheClip",
      verdict: "moved",
      detail: `${sel.anchor},${sel.head} → ${anchor},${head} (clip [${win.from},${hi}])`,
    });
    return [tr, { selection: { anchor, head }, sequential: true }];
  };
}
