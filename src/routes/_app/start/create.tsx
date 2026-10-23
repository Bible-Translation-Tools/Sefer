import { createFileRoute } from "@tanstack/solid-router";

import { t } from "#app/i18n";
import { Breadcrumb } from "#app/ui/landing/Breadcrumb";
import { CreateProject } from "#app/ui/landing/CreateProject";
import { ShellGate } from "#app/ui/ShellGate";
import "#app/ui/theme";

function CreateProjectRoute() {
  return (
    <main class="min-w-0 max-w-4xl space-y-4 p-6">
      <Breadcrumb
        crumbs={[
          { label: t("Sefer"), to: "/" },
          { label: t("Projects"), to: "/projects" },
          { label: t("Create") },
        ]}
      />
      <CreateProject />
    </main>
  );
}

export const Route = createFileRoute("/_app/start/create")({
  head: () => ({ meta: [{ title: "Sefer — create a project" }] }),
  component: () => <ShellGate>{() => <CreateProjectRoute />}</ShellGate>,
});
