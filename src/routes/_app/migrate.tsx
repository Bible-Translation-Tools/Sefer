import { createFileRoute } from "@tanstack/solid-router";

import { m } from "#app/paraglide/messages";
import { Breadcrumb } from "#app/ui/landing/Breadcrumb";
import { MigrateScreen } from "#app/ui/migrate/MigrateScreen";
import "#app/ui/theme";
import { ShellGate } from "#app/ui/ShellGate";

interface MigrateSearch {
  readonly into?: string;
  /** A Writer language picked on the projects page: its books are listed on arrival. */
  readonly language?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

function MigrateRoute() {
  const search = Route.useSearch();
  return (
    <main class="min-w-0 space-y-4 p-6">
      <Breadcrumb
        crumbs={[
          { label: m.common_sefer(), to: "/" },
          { label: m.common_projects(), to: "/projects" },
          { label: m.migrate_migrate_from_writer() },
        ]}
      />
      <MigrateScreen into={search().into} language={search().language} />
    </main>
  );
}

export const Route = createFileRoute("/_app/migrate")({
  validateSearch: (search: Record<string, unknown>): MigrateSearch => {
    const into = text(search.into);
    const language = text(search.language);
    return {
      ...(into === undefined ? {} : { into }),
      ...(language === undefined ? {} : { language }),
    };
  },
  head: () => ({ meta: [{ title: m.page_title({ page: m.page_migrate() }) }] }),
  component: () => <ShellGate>{() => <MigrateRoute />}</ShellGate>,
});
