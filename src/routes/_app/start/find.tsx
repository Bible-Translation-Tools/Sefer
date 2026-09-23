import { createFileRoute } from "@tanstack/solid-router";

import { t } from "#app/i18n";
import { FindProject } from "#app/ui/landing/FindProject";
import { LandingHeader } from "#app/ui/landing/LandingHeader";
import { ShellGate } from "#app/ui/ShellGate";
import "#app/ui/theme";

/**
 * The landing screen's second half: the remote catalogue, built to the
 * "Sefer / Find Project / Start" mockup. It shares `LandingHeader` with
 * `/projects`, so the segmented control moves between the two.
 */

function FindProjectRoute() {
  return (
    <main class="min-w-0 space-y-6 p-6">
      <LandingHeader
        tab="find"
        crumbs={[
          { label: t("Sefer"), to: "/" },
          { label: t("Projects"), to: "/projects" },
        ]}
      />
      <FindProject onDownloaded={() => undefined} />
    </main>
  );
}

export const Route = createFileRoute("/_app/start/find")({
  head: () => ({ meta: [{ title: "Sefer — find a project" }] }),
  component: () => <ShellGate>{() => <FindProjectRoute />}</ShellGate>,
});
