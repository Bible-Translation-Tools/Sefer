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
 * One named projection on a surface: the policy of that name alone
 * (`policyView`, below, says what that installs). The canonical editor and the
 * note editor pick by name; a card surface takes an `EditorPolicy`.
 */
export const modeView = (name: ProjectionName, surface?: string): Extension =>
  policyView({ mode: modeOf(name), presets: [name] }, surface);

/**
 * How a surface draws and guards its text: the behaviour matrix it opts into.
 *
 * `mode` is how markup reads (`regular` projects it, `usfm` shows it), and
 * `presets` are named `PROJECTIONS` laid over the default registry in order,
 * later winning — so "hidden notes" is `editorPolicy("regular", "hide-notes")`
 * and locked verse numbers in USFM is `editorPolicy("usfm", "lock-designators")`.
 * A surface asks for a policy; it never translates a toggle into a projection
 * itself, and nothing branches on the names — they are data, looked up here.
 *
 * The policy is judged as well as painted: a satellite carries its surface's
 * deltas to the Book (`SurfaceTerms.projection`), so what a policy hides and
 * freezes is also what the Book refuses there.
 */
export interface EditorPolicy {
  readonly mode: Mode;
  readonly presets: readonly ProjectionName[];
}

/** A policy: the mode's own projection, then each preset over it. */
export const editorPolicy = (mode: Mode, ...presets: readonly ProjectionName[]): EditorPolicy => ({
  mode,
  presets: [mode === "usfm" ? "usfm" : "default", ...presets],
});

/** One string per distinct policy, for a cache or a comparison. */
export const policyKey = (policy: EditorPolicy): string =>
  `${policy.mode}:${policy.presets.join("+")}`;

/**
 * The three things a policy IS on a surface, as one extension: an
 * `assignment` delta per preset (which classes paint how, and how mutable),
 * the `modeFacet` the rules and the paint port read, and the `cm-mode-*`
 * class the stylesheet keys on.
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
export const policyView = (policy: EditorPolicy, surface?: string): Extension => [
  ...policy.presets.map((name) => assignment.of(projectionFor(name))),
  modeFacet.of(policy.mode),
  EditorView.editorAttributes.of({
    class: surface === undefined ? `cm-mode-${policy.mode}` : `cm-mode-${policy.mode} ${surface}`,
  }),
];

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
