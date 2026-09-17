/**
 * The landing screen, first half: what is already on this device, and the three
 * ways to add to it.
 *
 * The second half — the remote catalogue — is `/start/find`, and the two share
 * `LandingHeader`. Both are routes so that each is a place you can link to.
 *
 * The only state here is `reload`: a counter the import hub raises and the
 * projects table reads, which is how an import that finished shows up in the
 * list without either component knowing the other exists.
 *
 * Rendered by BOTH `/` and `/projects` rather than redirecting one to the
 * other, so that `?fixture=1` — which the composition reads off `location`,
 * not off the router — survives landing on either.
 */

import { createSignal } from "solid-js";

import { t } from "../../i18n";
import { PanelHeader } from "../primitives";
import { RecoveryBanner } from "../recovery/RecoveryBanner";
import { ImportHub } from "./ImportHub";
import { LandingHeader } from "./LandingHeader";
import { YourProjects } from "./YourProjects";

export function ProjectsLanding() {
  const [reload, setReload] = createSignal(0, { name: "projectsReload" });

  return (
    <main class="min-w-0 space-y-6 p-6">
      <LandingHeader
        tab="yours"
        crumbs={[
          { label: t("Sefer"), to: "/" },
          { label: t("Projects"), to: "/" },
        ]}
      />

      {/* Above everything, and only when there is something to answer: work
          that exists nowhere but the journal is the first thing someone who
          crashed needs to see, before the list of what to open next. */}
      <RecoveryBanner />

      <section class="space-y-3">
        <PanelHeader
          title={t("Your projects")}
          subtitle={t("Open an existing project, or bring a new one in below.")}
        />
        <YourProjects reload={reload()} />
      </section>

      <section class="space-y-3">
        <PanelHeader
          level={3}
          title={t("Add a project")}
          subtitle={t("Import a linked cloud project, or copy one in from this device.")}
        />
        <ImportHub onImported={() => setReload((held) => held + 1)} />
      </section>
    </main>
  );
}
