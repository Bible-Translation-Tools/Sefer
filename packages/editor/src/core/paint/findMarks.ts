import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

import { structureAt } from "../model/docStructure";

/**
 * The floating Find box's highlights: every match in this book, and the one
 * the reader is on drawn darker. The host computes the matches (the project
 * search) and hands them in; the field only maps them through edits until the
 * host answers with a fresh list.
 */
export interface FindMarks {
  readonly ranges: readonly { readonly from: number; readonly to: number }[];
  /** Index into `ranges` of the current match, or -1 when it is in another book. */
  readonly active: number;
  /**
   * The current match's verse, as chapter × 1000 + verse, wherever the match
   * is. Both texts keep this verse bright and grey the rest, so a reader can
   * look across and find the same verse in the other text.
   */
  readonly verse?: number;
}

export const setFindMarks = StateEffect.define<FindMarks | null>();

const MATCH = Decoration.mark({ class: "usfm-find" });
const ACTIVE = Decoration.mark({ class: "usfm-find usfm-find-active" });
/** Everything outside the active match's verse, greyed so the reader's eye lands on it. */
const DIM = Decoration.mark({ class: "usfm-find-dim" });

/** The verse keyed chapter × 1000 + verse (a bridge holds each of its numbers), or undefined. */
export const verseRangeOf = (
  state: EditorState,
  key: number,
): { from: number; to: number } | undefined => {
  const chapterNumber = Math.floor(key / 1000);
  const verseNumber = key % 1000;
  const { verses, chapters } = structureAt(state);
  const chapter = chapters.find((row) => Number.parseInt(row.label, 10) === chapterNumber);
  if (chapter === undefined) return undefined;
  if (verseNumber === 0) return { from: chapter.from, to: chapter.to };
  for (let i = 0; i < verses.length; i++) {
    const row = verses[i]!;
    if (row.markerFrom < chapter.from || row.markerFrom >= chapter.to) continue;
    const [first, last] = (row.num ?? "").split("-").map((part) => Number.parseInt(part, 10));
    if (first === undefined || Number.isNaN(first)) continue;
    const upTo = last === undefined || Number.isNaN(last) ? first : last;
    if (verseNumber < first || verseNumber > upTo) continue;
    const next = verses[i + 1]?.markerFrom ?? state.doc.length;
    return { from: row.markerFrom, to: Math.min(next, chapter.to) };
  }
  return undefined;
};

const dimOutside = (state: EditorState, verse: { from: number; to: number }) => {
  const length = state.doc.length;
  const out = [];
  if (verse.from > 0) out.push(DIM.range(0, verse.from));
  if (verse.to < length) out.push(DIM.range(verse.to, length));
  return out;
};

const build = (marks: FindMarks | null, state: EditorState): DecorationSet => {
  if (marks === null) return Decoration.none;
  const length = state.doc.length;
  const drawn = marks.ranges
    .map((range, at) => ({ ...range, active: at === marks.active }))
    .filter((range) => range.from < range.to && range.to <= length)
    .sort((a, b) => a.from - b.from)
    .map((range) => (range.active ? ACTIVE : MATCH).range(range.from, range.to));
  const verse = marks.verse === undefined ? undefined : verseRangeOf(state, marks.verse);
  const dim = verse === undefined ? [] : dimOutside(state, verse);
  return Decoration.set([...drawn, ...dim], true);
};

export const findMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(held, tr) {
    let next = held.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(setFindMarks)) next = build(effect.value, tr.state);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
