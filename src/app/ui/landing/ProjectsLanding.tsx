/**
 * The projects page: what is already on this device, then what is available
 * on WACS to download.
 *
 * Two sections, one page. There is no longer a separate find screen
 * (`/start/find` now lands here), and the add-a-project cards are gone for
 * now — their functionality is moving elsewhere (`ImportHub` is kept, unused).
 *
 * The only state here is `reload`: a counter a download raises and the
 * projects table reads, which is how a download that finished shows up in the
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
import { WacsProjects } from "./WacsProjects";
import { YourProjects } from "./YourProjects";

export function ProjectsLanding() {
  const [reload, setReload] = createSignal(0, { name: "projectsReload" });

  return (
    <main class="min-w-0 space-y-8 p-6">
      {/* Above everything, and only when there is something to answer: work
          that exists nowhere but the journal is the first thing someone who
          crashed needs to see, before the list of what to open next. */}
      <RecoveryBanner />

      <section class="space-y-3">
        <PanelHeader title={t("Projects Loaded into Sefer")} />
        <YourProjects reload={reload()} />
      </section>

      <WacsProjects onDownloaded={() => setReload((held) => held + 1)} />
    </main>
  );
}
