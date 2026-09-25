/**
 * Views: the two things a mode or a chapter choice actually is.
 *
 * A "view" in Sefer is not a component and not a second editor — it is a
 * projection (which classes paint, and how) plus a clip (which chapter is
 * editable). Both are already data: `PROJECTIONS` in `core/registry.ts` and
 * the pick effect in `core/clip.ts`. This file is the two named doors §3.6
 * asks for, and nothing else — no rule anywhere branches on a mode name.
 */

import type { EditorState, Extension, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { anchorFrom, setPick } from "./core/clip";
import { structureAt } from "./core/docStructure";
import { type Mode, modeFacet } from "./core/kernel";
import { PROJECTIONS, assignment, type AssignmentDelta } from "./core/registry";

/** The projection names `PROJECTIONS` defines. */
export type ProjectionName = keyof typeof PROJECTIONS | (string & {});

/**
 * The assignment delta for a mode — presentation only. An unknown name reads
 * as `default` (every class as the registry has it) rather than throwing: a
 * mode is a UI choice, and a typo in one must not take the editor down.
 */
const projectionFor = (mode: ProjectionName): AssignmentDelta =>
  PROJECTIONS[mode] ?? PROJECTIONS.default;

/** The kernel mode a projection is read in: `usfm` shows markup, everything else is regular. */
const modeOf = (name: ProjectionName): Mode => (name === "usfm" ? "usfm" : "regular");

/**
 * The three things a projection IS on a surface, as one extension: the
 * `assignment` delta (which classes paint how), the `modeFacet` the rules and
 * the paint port read, and the `cm-mode-*` class the stylesheet keys on.
 *
 * One rule, stated once, because every surface that shows USFM needs all
 * three and in step — a projection without its mode paints one way and is
 * judged another. `surface` names the surface for the stylesheet
 * (`cm-excerpt`, `cm-note`) and rides the same attribute.
 *
 * The class goes through `editorAttributes`, never `view.dom.classList`:
 * CodeMirror rewrites the editor's class from its facets on every update, so a
 * class added by hand survives until the first keystroke or focus change.
 *
 * This is NOT the reading layer. What a surface decorates with is its own
 * choice: the canonical editor and an excerpt install `readingLayer`, and the
 * note editor installs only the structure and its own apparatus, because the
 * regular reading projection collapses a note to its caller — the very text
 * that surface exists to show.
 */
export const modeView = (name: ProjectionName, surface?: string): Extension => {
  const mode = modeOf(name);
  return [
    assignment.of(projectionFor(name)),
    modeFacet.of(mode),
    EditorView.editorAttributes.of({
      class: surface === undefined ? `cm-mode-${mode}` : `cm-mode-${mode} ${surface}`,
    }),
  ];
};

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
