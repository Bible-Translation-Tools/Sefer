import { Outlet, createFileRoute } from "@tanstack/solid-router";
import { Match, Switch, createEffect, createSignal, untrack } from "solid-js";

import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { DelayedSpinner } from "#app/ui/primitives";
import { ShellGate } from "#app/ui/ShellGate";
import "#app/ui/theme";

function ProjectLayout() {
  const shell = useShell();
  const params = Route.useParams();

  const [phase, setPhase] = createSignal<"opening" | "ready" | "unknown">("opening");

  createEffect(
    () => params().slug,
    (slug) => {
      const root = shell.rootForSlug(slug);
      if (root === undefined) {
        setPhase("unknown");
        return;
      }
      // A one-time question, not a subscription: is this project already the open one?
      if (untrack(() => shell.project()?.root) === root) {
        setPhase("ready");
        return;
      }
      setPhase("opening");
      void shell.openProject(root).then(() => {
        setPhase(untrack(() => shell.project()?.root) === root ? "ready" : "unknown");
      });
    },
  );

  return (
    <Switch>
      <Match when={phase() === "ready"}>
        <Outlet />
      </Match>
      <Match when={phase() === "unknown"}>
        <main data-testid="no-project" aria-label={t("No project open")} class="h-full" />
      </Match>
      <Match when={phase() === "opening"}>
        {/* The open reads every book, parses every book and proofreads the
            whole corpus before it answers — ~600ms for a Bible. Stated once,
            here, rather than per screen, and blank unless it runs long. */}
        <DelayedSpinner />
      </Match>
    </Switch>
  );
}

export const Route = createFileRoute("/_app/project/$slug")({
  component: () => <ShellGate>{() => <ProjectLayout />}</ShellGate>,
});
