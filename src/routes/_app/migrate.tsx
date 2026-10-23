import { createFileRoute } from "@tanstack/solid-router";

import { t } from "#app/i18n";
import { Breadcrumb } from "#app/ui/landing/Breadcrumb";
import { MigrateScreen } from "#app/ui/migrate/MigrateScreen";
import { ShellGate } from "#app/ui/ShellGate";
import "#app/ui/theme";

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
          { label: t("Sefer"), to: "/" },
          { label: t("Projects"), to: "/projects" },
          { label: t("Migrate from Writer") },
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
  head: () => ({ meta: [{ title: "Migrate from Writer · Sefer" }] }),
  component: () => <ShellGate>{() => <MigrateRoute />}</ShellGate>,
});
