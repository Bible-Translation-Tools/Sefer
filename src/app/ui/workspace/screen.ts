import { useRouterState } from "@tanstack/solid-router";

export interface Screen {
  readonly onEditor: () => boolean;
  readonly onMode: () => boolean;
  readonly inProject: () => boolean;
  readonly versionsTab: () => VersionsTab | undefined;
}

export type VersionsTab = "changes" | "history" | "suggestions";

export const useScreen = (): Screen => {
  const leaf = useRouterState({ select: (state) => state.matches.at(-1)?.routeId });
  const inProject = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === "/_app/project/$slug"),
  });
  const onEditor = (): boolean =>
    leaf() === "/_app/project/$slug/book/$book" || leaf() === "/_app/project/$slug/";
  const versionsTab = (): VersionsTab | undefined => {
    switch (leaf()) {
      case "/_app/project/$slug/review":
        return "changes";
      case "/_app/project/$slug/history":
        return "history";
      case "/_app/project/$slug/suggestions":
        return "suggestions";
      default:
        return undefined;
    }
  };
  return {
    versionsTab,
    onEditor,
    onMode: () => onEditor() || leaf() === "/_app/project/$slug/terms",
    inProject,
  };
};
