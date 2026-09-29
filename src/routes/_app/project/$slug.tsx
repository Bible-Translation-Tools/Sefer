import { Outlet, createFileRoute } from "@tanstack/solid-router";
import { Match, Switch, createEffect, createSignal, untrack } from "solid-js";

import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { EmptyState } from "#app/ui/primitives";
import { ShellGate } from "#app/ui/ShellGate";
import "#app/ui/theme";

/**
 * `/project/$slug` — the layout every project screen lives inside, and the ONE
 * place a project is opened.
 *
 * Before this route there were three: the census page, the book route, and the
 * landing list each called `shell.openProject` and each guarded it with "is
 * this one already open" — a question they answered by reading `project()`,
 * which is not set until the open has finished. For the ~600ms in between, all
 * three answered "no". Landing on a project and forwarding to a book could
 * therefore open it twice.
 *
 * A parent route fixes that by structure rather than by a lock: there is one
 * effect, keyed on one param, and a child cannot run before it has resolved.
 *
 * It is a COMPONENT and not a TanStack `loader`, which is the compromise worth
 * naming. A loader runs outside the component tree, and the shell is a Solid
 * context created by the root route's component, so a loader cannot reach
 * `openProject` without hoisting the whole provider out of the tree. That is a
 * bigger change than this one and it is the version to build if loaders ever
 * need to do more than this. What is NOT compromised is the property that
 * mattered: below here, `shell.project()` is the project this URL names.
 */

function ProjectLayout() {
  const shell = useShell();
  const params = Route.useParams();

  const [phase, setPhase] = createSignal<"opening" | "ready" | "unknown">("opening");

  createEffect(
    () => params().slug,
    (slug) => {
      const root = shell.rootForSlug(slug);
      // A slug nothing answers to: a bookmark to a project that has been
      // removed, or a hand-typed URL. Draw an empty main area rather than
      // opening something else or hanging on a spinner forever; the panel
      // beside it is the way to a project.
      if (root === undefined) {
        setPhase("unknown");
        return;
      }
      // `untrack`, because this is a one-time question and not a subscription:
      // is the project this URL names already the open one? Re-entering the
      // same project from a child route must not re-open it.
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
      {/* A slug nothing answers to draws nothing here: the project panel
          beside it says what the space is for, and its project control is
          the way to a project. */}
      <Match when={phase() === "unknown"}>
        <main data-testid="no-project" aria-label={t("No project open")} class="h-full" />
      </Match>
      <Match when={phase() === "opening"}>
        {/* The open reads every book, parses every book and proofreads the
            whole corpus before it answers — ~600ms for a Bible — so this is a
            real wait and it is stated once, here, rather than per screen. */}
        <EmptyState
          title={t("opening…")}
          description={t("reading, parsing and proofreading the project.")}
        />
      </Match>
    </Switch>
  );
}

export const Route = createFileRoute("/_app/project/$slug")({
  component: () => <ShellGate>{() => <ProjectLayout />}</ShellGate>,
});
