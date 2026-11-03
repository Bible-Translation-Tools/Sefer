import { createFileRoute } from "@tanstack/solid-router";

import { m } from "#app/paraglide/messages";
import { Breadcrumb } from "#app/ui/landing/Breadcrumb";
import { CreateProject } from "#app/ui/landing/CreateProject";
import "#app/ui/theme";
import { ShellGate } from "#app/ui/ShellGate";

function CreateProjectRoute() {
  return (
    <main class="min-w-0 max-w-4xl space-y-4 p-6">
      <Breadcrumb
        crumbs={[
          { label: m.common_sefer(), to: "/" },
          { label: m.common_projects(), to: "/projects" },
          { label: m.landing_create() },
        ]}
      />
      <CreateProject />
    </main>
  );
}

export const Route = createFileRoute("/_app/start/create")({
  head: () => ({ meta: [{ title: m.page_title({ page: m.page_create() }) }] }),
  component: () => <ShellGate>{() => <CreateProjectRoute />}</ShellGate>,
});
