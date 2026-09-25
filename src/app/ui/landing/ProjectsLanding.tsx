/**
 * The projects page: what is already on this device, then what is available
 * on WACS to download.
 *
 * Two sections, one page. There is no separate find screen, and the
 * add-a-project cards are gone:
 * importing is `ImportHub`, as buttons under the table and as the rail's menu.
 *
 * The state here is `reload`, a counter a download raises and the projects
 * list reads, and `downloads`: every download the WACS table started, which
 * the installed row draws as a card with a progress bar until the project it
 * becomes is listed. A downloaded project stays in the WACS table too.
 *
 * Rendered by BOTH `/` and `/projects` rather than redirecting one to the
 * other, so that `?fixture=1` — which the composition reads off `location`,
 * not off the router — survives landing on either.
 */

import { createSignal } from "solid-js";

import { t } from "../../i18n";
import { PanelHeader } from "../primitives";
import { RecoveryBanner } from "../recovery/RecoveryBanner";
import type { PendingDownload } from "./downloads";
import { WacsProjects } from "./WacsProjects";
import { YourProjects } from "./YourProjects";

export function ProjectsLanding() {
  const [reload, setReload] = createSignal(0, { name: "projectsReload" });
  /** Downloads started from the WACS table, newest first, until listed. */
  const [downloads, setDownloads] = createSignal<readonly PendingDownload[]>([], {
    name: "pendingDownloads",
  });
  /** Where the latest download's row was, for the fly-up animation. */
  const [flyFrom, setFlyFrom] = createSignal<DOMRect>();

  return (
    <main class="flex h-full min-w-0 flex-col gap-8 overflow-hidden p-6">
      {/* Above everything, and only when there is something to answer: work
          that exists nowhere but the journal is the first thing someone who
          crashed needs to see, before the list of what to open next. */}
      <RecoveryBanner />

      <section class="shrink-0 space-y-3">
        <PanelHeader title={t("Projects Loaded into Sefer")} />
        <YourProjects
          reload={reload()}
          downloads={downloads()}
          flyFrom={flyFrom()}
          onDismiss={(id) => setDownloads((held) => held.filter((item) => item.id !== id))}
        />
      </section>

      <WacsProjects
        onDownloaded={() => setReload((held) => held + 1)}
        downloads={{
          start: (download, from) => {
            setFlyFrom(from);
            setDownloads((held) => [download, ...held.filter((item) => item.id !== download.id)]);
          },
          update: (id, patch) =>
            setDownloads((held) =>
              held.map((item) => (item.id === id ? { ...item, ...patch } : item)),
            ),
        }}
      />
    </main>
  );
}
