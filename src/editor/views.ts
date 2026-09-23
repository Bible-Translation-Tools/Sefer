/**
 * Views: the two things a mode or a chapter choice actually is.
 *
 * A "view" in Sefer is not a component and not a second editor — it is a
 * projection (which classes paint, and how) plus a clip (which chapter is
 * editable). Both are already data: `PROJECTIONS` in `core/registry.ts` and
 * the pick effect in `core/clip.ts`. This file is the two named doors §3.6
 * asks for, and nothing else — no rule anywhere branches on a mode name.
 */

import type { EditorState, TransactionSpec } from "@codemirror/state";

import { anchorFrom, setPick } from "./core/clip";
import { structureAt } from "./core/docStructure";
import { PROJECTIONS, type AssignmentDelta } from "./core/registry";

/** The projection names `PROJECTIONS` defines. */
export type ProjectionName = keyof typeof PROJECTIONS | (string & {});

/**
 * The assignment delta for a mode — presentation only. An unknown name reads
 * as `default` (every class as the registry has it) rather than throwing: a
 * mode is a UI choice, and a typo in one must not take the editor down.
 */
export const projectionFor = (mode: ProjectionName): AssignmentDelta =>
  PROJECTIONS[mode] ?? PROJECTIONS.default;

/**
 * The transaction that clips the editor to one chapter, by ordinal (0-based
 * over `structure.chapters`), or `null` to clip to nothing and show the whole
 * book. An ordinal outside the chapter list also clears the pick.
 *
 * Returns a spec rather than a `Transaction`, because the caller knows where
 * it is going — `view.dispatch(pickChapter(state, 2))` for a mounted book,
 * `state.update(…)` for a headless one — and a spec works for both.
 */
export const pickChapter = (state: EditorState, ordinal: number | null): TransactionSpec => {
  if (ordinal === null) return { effects: setPick.of(null) };
  const chapter = structureAt(state).chapters[ordinal];
  return { effects: setPick.of(chapter === undefined ? null : anchorFrom(chapter)) };
};
