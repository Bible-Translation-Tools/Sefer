import { createFileRoute } from "@tanstack/solid-router";

import { ProjectsLanding } from "#app/ui/landing/ProjectsLanding";
import { ShellGate } from "#app/ui/ShellGate";
import "#app/ui/theme";

/**
 * `/projects` — every project on this device, always.
 *
 * It exists so that `/` can mean the other thing. Sefer opens into the project
 * you were last in, because an editor that lands you on a list every morning
 * has made you navigate back to your own work — but "show me my projects" has
 * to mean it, and one URL cannot honestly mean both. Two URLs can:
 *
 *     /           the work: your last project, or this list when there is none
 *     /projects   this list
 *
 * The version before this one had only `/` and tried to tell the two apart by
 * WHEN — a module-level "have I already jumped" flag. It was wrong in both
 * directions. The flag reset on every page load, so `/` could not be reached
 * by URL at all; and it was spent by the first mount, so clicking Projects
 * from a screen that had never shown the list bounced straight back into the
 * project. There is nothing to track now: the URL says which you asked for.
 */

export const Route = createFileRoute("/_app/projects")({
  head: () => ({ meta: [{ title: "Projects · Sefer" }] }),
  component: () => <ShellGate>{() => <ProjectsLanding />}</ShellGate>,
});
