import { Link, createFileRoute } from "@tanstack/solid-router";

import { t } from "../app/i18n";

function Home() {
  return (
    <main class="plain">
      <h1>{t("Sefer")}</h1>
      <p>{t("Local-first scripture editing, beginning with exact source text.")}</p>
      <p>
        <Link to="/projects">{t("Projects")}</Link>
      </p>
    </main>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Sefer" }] }),
  component: Home,
});
