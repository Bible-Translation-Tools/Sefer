import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Show, createSignal, onCleanup, untrack } from "solid-js";

import { useShell } from "#app/ProjectContext";
import { shellKeys } from "#app/settings";
import { ProjectsLanding } from "#app/ui/landing/ProjectsLanding";
import { listProjects } from "#app/ui/landing/summaries";
import { ShellGate } from "#app/ui/ShellGate";
import { EmptyWorkspace } from "#app/ui/workspace/EmptyWorkspace";
import "#app/ui/theme";

/**
 * `/` is THE WORK: the project you were last in, or the projects list when
 * this device has none.
 *
 * The list itself is `/projects`, which is always the list — see the note
 * there for why the two are separate routes rather than one URL that tries to
 * be both.
 *
 * Not a `beforeLoad` redirect, which is where a router would normally put
 * this. Two reasons, and the second is the binding one:
 *
 *  - the composition reads `?fixture=1` off `location` before the router
 *    exists, and a redirect that dropped the search would silently compose
 *    over OPFS instead of the seeded fixture;
 *  - the answer lives in `shell.recentProjects()`, and the shell is a Solid
 *    context created by the root route's COMPONENT. A loader runs outside the
 *    component tree and cannot reach it without hoisting the provider out —
 *    the same trade `/project/$slug` makes, and the same note applies: this is
 *    the version to revisit if loaders ever need to do more than choose.
 */

function Landing() {
  const shell = useShell();
  const navigate = useNavigate();

  // Called straight through rather than wrapped in an effect: it is a one-shot
  // decision made at mount, with no reactive input to re-run on. `ShellGate`
  // above guarantees the shell exists by the time this body runs.
  const enter = (): boolean => {
    // Newest first, so row zero is where they were.
    const last = untrack(() => shell.recentProjects())[0];
    if (last === undefined) return false;
    void navigate({
      to: "/project/$slug",
      params: { slug: shell.slugFor(last.root) },
      replace: true,
    });
    return true;
  };

  // No history is not the same as nothing installed: a project can be on disk
  // and never opened here. Only an empty list earns the first-run shell.
  // `undefined` while the list is being read, so neither screen flashes.
  const [empty, setEmpty] = createSignal<boolean | undefined>(undefined, { name: "deviceEmpty" });
  if (!enter()) {
    const { services } = shell;
    const recent = shellKeys(services.settings).recentProjects;
    void services
      .run(
        listProjects(services.projectsRoot, services.fixtureProject, services.settings.get(recent)),
      )
      .then((rows) => {
        setEmpty(rows.length === 0);
        shell.setFirstRun(rows.length === 0);
      });
  }
  onCleanup(() => shell.setFirstRun(false));

  // A first run, or a device whose projects have all been removed: there is no
  // work to go to, so the list IS the answer. Rendered rather than redirected,
  // because a redirect to `/projects` would put a screen in the back stack
  // that pressing Back could only bounce off.
  return (
    <Show when={empty() !== undefined}>
      <Show when={empty()} fallback={<ProjectsLanding />}>
        <EmptyWorkspace />
      </Show>
    </Show>
  );
}

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Sefer" }] }),
  component: () => <ShellGate>{() => <Landing />}</ShellGate>,
});
