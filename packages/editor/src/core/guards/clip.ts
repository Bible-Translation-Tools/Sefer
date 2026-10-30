import { EditorState, Facet, MapMode, StateEffect, StateField, type Text } from "@codemirror/state";

import { note, noteTr } from "../instrument/trace";
import { isTrusted, type ChangeRule, type TransactionRule } from "../kernel";
import { type ChapterRow, type DocStructure, structureField } from "../model/docStructure";

export function chapterContaining(chapters: readonly ChapterRow[], pos: number): ChapterRow | null {
  let found: ChapterRow | null = null;
  for (const c of chapters) {
    if (c.from > pos) break;
    found = c;
  }
  return found;
}

export const setPick = StateEffect.define<number | null>();

export const anchorFrom = (chapter: ChapterRow) =>
  chapter.label ? chapter.labelFrom : chapter.from;

export const pickField = StateField.define<number | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setPick)) return e.value;
    if (v === null || !tr.docChanged) return v;
    return tr.changes.mapPos(v, 1, MapMode.TrackDel);
  },
});

function resolvePick(structure: DocStructure, doc: Text, at: number | null): ChapterRow | null {
  if (at === null) return null;
  return chapterContaining(structure.chapters, Math.max(0, Math.min(at, doc.length)));
}

export type ClipRange = { from: number; to: number } | null;

function pickedChapter(st: EditorState): ChapterRow | null {
  const structure = st.field(structureField, false);
  return structure ? resolvePick(structure, st.doc, st.field(pickField, false) ?? null) : null;
}

interface Extents {
  visible: { from: number; to: number };
  editable: { from: number; to: number };
}

function chapterExtents(chapter: ChapterRow, doc: Text): Extents {
  const to = Math.min(chapter.to, doc.length);
  const visible = { from: chapter.from, to };
  if (!chapter.label) return { visible, editable: visible };
  const marker = doc.lineAt(Math.min(chapter.labelTo, doc.length));
  const after = marker.number < doc.lines ? doc.line(marker.number + 1).from : to;
  return { visible, editable: { from: Math.max(chapter.from, Math.min(after, to)), to } };
}

export function editableClipAt(st: EditorState): ClipRange {
  const chapter = pickedChapter(st);
  return chapter ? chapterExtents(chapter, st.doc).editable : null;
}

export function visibleClipAt(st: EditorState): ClipRange {
  const chapter = pickedChapter(st);
  return chapter ? chapterExtents(chapter, st.doc).visible : null;
}

/** Whether a `trusted` edit may pass a range rule. The chapter clip: yes. */
export interface RangeRuleOptions {
  readonly trustWaives?: boolean;
}

/**
 * The range of the SURFACE an edit came from, when it came from one.
 *
 * Empty on the canonical state — the canonical editor's own range is the
 * chapter clip above. The Book installs it on the state it judges a
 * satellite's edit in (`book.ts`, `applyFrom`), from the range the satellite
 * submitted with the edit, and `refuseEditsOutsideTheSurface` (`phases.ts`)
 * reads it: the same rule as the chapter clip, over a different range, and
 * never waived by trust.
 */
export const surfaceRange = Facet.define<
  { from: number; to: number },
  { from: number; to: number } | null
>({ combine: (values) => values[0] ?? null });

export const surfaceRangeAt = (state: EditorState): ClipRange => state.facet(surfaceRange);

export function refuseEditsOutsideTheClip(
  getRange: (state: EditorState) => { from: number; to: number } | null,
  { trustWaives = true }: RangeRuleOptions = {},
): ChangeRule {
  return (tr) => {
    if (trustWaives && isTrusted(tr)) return true;
    const range = getRange(tr.startState);
    if (!range) return true;
    const len = tr.startState.doc.length;
    const out: number[] = [];
    if (range.from > 0) out.push(0, range.from);
    if (range.to < len) out.push(range.to, len);
    if (!out.length) return true;
    note(tr.startState, {
      rule: "refuseEditsOutsideTheClip",
      verdict: "passed",
      detail: `guarding everything outside the clip [${range.from},${range.to})`,
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
    const windowRange = getRange(tr.state);
    if (!windowRange) return tr;
    let hi = windowRange.to;
    if (windowRange.to < tr.state.doc.length)
      while (hi > windowRange.from && /[\r\n]/.test(tr.state.doc.sliceString(hi - 1, hi))) hi--;
    const fit = (p: number) => Math.max(windowRange.from, Math.min(hi, p));
    const sel = tr.selection.main;
    const anchor = fit(sel.anchor);
    const head = fit(sel.head);
    if (anchor === sel.anchor && head === sel.head) return tr;
    noteTr(tr, {
      rule: "pullSelectionsIntoTheClip",
      verdict: "moved",
      detail: `${sel.anchor},${sel.head} → ${anchor},${head} (clip [${windowRange.from},${hi}])`,
    });
    return [tr, { selection: { anchor, head }, sequential: true }];
  };
}
