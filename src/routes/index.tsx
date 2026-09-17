import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { untrack } from "solid-js";

import { useShell } from "../app/ProjectContext";
import { ProjectsLanding } from "../app/ui/landing/ProjectsLanding";
import { ShellGate } from "../app/ui/ShellGate";
import "../app/ui/theme";

/**
 * `/` IS the projects screen, and on a cold start it is also the door to the
 * last project.
 *
 * A redirect from `/` to a landing route would be tidier in the route tree and
 * worse in practice: the composition reads `?fixture=1` off `location` before
 * the router exists, and a redirect that dropped the search would silently
 * compose over OPFS instead of the seeded fixture.
 */

/**
 * Whether this page load has already made its one automatic jump.
 *
 * MODULE level, not component state, and that is the whole mechanism. Sefer
 * opens into the project you were last in — an editor that lands you on a list
 * every morning has made you navigate back to your own work — but "go to my
 * projects" has to mean it. Both are the same URL, so the two are told apart
 * by WHEN: the first arrival at `/` in a page load is a cold start and
 * forwards; every arrival after it is a person asking for the list, and stays.
 *
 * Component state would reset on every mount and forward again, which is the
 * redirect loop. A flag that lives as long as the page load cannot.
 */
let jumped = false;

function ProjectsHome() {
  const shell = useShell();
  const navigate = useNavigate();

  // Called straight through rather than wrapped in an effect: it is a one-shot
  // decision made at mount, with no reactive input to re-run on. `ShellGate`
  // above guarantees the shell exists by the time this body runs.
  const jumpOnce = (): void => {
    if (jumped) return;
    jumped = true;
    // Newest first, so row zero is where they were. A device with no history
    // has nothing to jump to and shows the list, which is also what a first
    // run should do.
    const last = untrack(() => shell.recentProjects())[0];
    if (last === undefined) return;
    void navigate({
      to: "/project/$slug",
      params: { slug: shell.slugFor(last.root) },
      replace: true,
    });
  };
  jumpOnce();

  // Rendered while the jump is being decided as well as after it is declined:
  // the list is the honest thing to show for the one frame it takes, and a
  // spinner that flashes is worse than a list that is already right.
  return <ProjectsLanding />;
}

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Sefer" }] }),
  component: () => <ShellGate>{() => <ProjectsHome />}</ShellGate>,
});
