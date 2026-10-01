/**
 * Which screen the workspace is showing, asked of the route that matched.
 *
 * Route IDs from the generated tree, never a pathname test: every project
 * screen lives under `/project/$slug/`, so a prefix cannot tell them apart, and
 * a predicate like `path().includes("/book/")` silently rots when screens move.
 * A route ID cannot rot that way — rename a screen and each comparison below is
 * a compile error. `_app` is the pathless layout every workspace screen sits
 * under, so it is part of the ID while absent from the URL (`routes/_app.tsx`).
 *
 * One answer for the chrome that has to know: `BackToEditor` shows its door
 * off the editor, and `PanelToggleColumn` carries the panel toggle on project
 * screens that have no editor toolbar to carry it.
 */

import { useRouterState } from "@tanstack/solid-router";

export interface Screen {
  /**
   * The editor: the book, and the project route itself, which forwards to the
   * book. Every other screen sits over the top of it.
   */
  readonly onEditor: () => boolean;
  /**
   * A mode's own screen — Refine's, the editor, or Key terms. The mode
   * switcher is the way between them, so neither needs a door back.
   */
  readonly onMode: () => boolean;
  /** Inside a project's routes: the editor, or a project screen over it. */
  readonly inProject: () => boolean;
}

export const useScreen = (): Screen => {
  // Two primitive selects, so a navigation that changes neither wakes nothing.
  const leaf = useRouterState({ select: (state) => state.matches.at(-1)?.routeId });
  const inProject = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === "/_app/project/$slug"),
  });
  const onEditor = (): boolean =>
    leaf() === "/_app/project/$slug/book/$book" || leaf() === "/_app/project/$slug/";
  return {
    onEditor,
    onMode: () => onEditor() || leaf() === "/_app/project/$slug/terms",
    inProject,
  };
};
