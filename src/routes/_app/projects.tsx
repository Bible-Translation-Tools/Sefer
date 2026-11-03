import { createFileRoute } from "@tanstack/solid-router";

import { m } from "#app/paraglide/messages";
import { ProjectsLanding } from "#app/ui/landing/ProjectsLanding";
import "#app/ui/theme";
import { ShellGate } from "#app/ui/ShellGate";

export const Route = createFileRoute("/_app/projects")({
  validateSearch: (search: Record<string, unknown>): { readonly rename?: string } =>
    typeof search.rename === "string" ? { rename: search.rename } : {},
  head: () => ({ meta: [{ title: m.page_title({ page: m.page_projects() }) }] }),
  component: () => <ShellGate>{() => <ProjectsLanding />}</ShellGate>,
});
