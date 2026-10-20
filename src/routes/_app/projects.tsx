import { createFileRoute } from "@tanstack/solid-router";

import { ProjectsLanding } from "#app/ui/landing/ProjectsLanding";
import { ShellGate } from "#app/ui/ShellGate";
import "#app/ui/theme";

export const Route = createFileRoute("/_app/projects")({
  head: () => ({ meta: [{ title: "Projects · Sefer" }] }),
  component: () => <ShellGate>{() => <ProjectsLanding />}</ShellGate>,
});
