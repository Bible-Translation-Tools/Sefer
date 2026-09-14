import { createFileRoute } from "@tanstack/solid-router";

import { ProjectsLanding } from "../app/ui/landing/ProjectsLanding";
import { ShellGate } from "../app/ui/ShellGate";
// Applied on import so the first paint is already in the chosen scheme.
import "../app/ui/theme";

export const Route = createFileRoute("/projects")({
  head: () => ({ meta: [{ title: "Sefer — projects" }] }),
  component: () => <ShellGate>{() => <ProjectsLanding />}</ShellGate>,
});
