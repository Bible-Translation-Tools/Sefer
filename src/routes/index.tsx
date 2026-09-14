import { Link, createFileRoute } from "@tanstack/solid-router";

import { t } from "../app/i18n";
import { Card } from "../app/ui/primitives";

function Home() {
  return (
    <main class="mx-auto w-full max-w-3xl p-10">
      <Card class="space-y-3">
        <h1 class="text-h2 font-bold text-on-surface-primary">{t("Sefer")}</h1>
        <p class="text-on-surface-secondary">
          {t("Local-first scripture editing, beginning with exact source text.")}
        </p>
        <p>
          <Link to="/projects" class="text-small font-medium text-brand hover:underline">
            {t("Projects")}
          </Link>
        </p>
      </Card>
    </main>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Sefer" }] }),
  component: Home,
});
