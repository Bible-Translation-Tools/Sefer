import { createFileRoute } from "@tanstack/solid-router";

import { t } from "#app/i18n";
import { Breadcrumb } from "#app/ui/landing/Breadcrumb";
import { MigrateScreen } from "#app/ui/migrate/MigrateScreen";
import { ShellGate } from "#app/ui/ShellGate";
import "#app/ui/theme";

/**
 * `/migrate` — assemble a project from BTT Writer's single-book projects.
 * Reached from the projects page's Import; see `MigrateScreen`.
 */

interface MigrateSearch {
  /** A project's root: Books → "Add a book…" brings books into it. */
  readonly into?: string;
}

function MigrateRoute() {
  const search = Route.useSearch();
  return (
    <main class="min-w-0 space-y-4 p-6">
      <Breadcrumb
        crumbs={[
          { label: t("Sefer"), to: "/" },
          { label: t("Projects"), to: "/projects" },
          { label: t("Migrate from Writer") },
        ]}
      />
      <MigrateScreen into={search().into} />
    </main>
  );
}

export const Route = createFileRoute("/_app/migrate")({
  validateSearch: (search: Record<string, unknown>): MigrateSearch =>
    typeof search.into === "string" && search.into !== "" ? { into: search.into } : {},
  head: () => ({ meta: [{ title: "Migrate from Writer · Sefer" }] }),
  component: () => <ShellGate>{() => <MigrateRoute />}</ShellGate>,
});
