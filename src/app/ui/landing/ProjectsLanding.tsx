import { createSignal } from "solid-js";

import { t } from "../../i18n";
import { PanelHeader } from "../primitives";
import { RecoveryBanner } from "../recovery/RecoveryBanner";
import type { PendingDownload } from "./downloads";
import { WacsProjects } from "./WacsProjects";
import { YourProjects } from "./YourProjects";

export function ProjectsLanding() {
  const [downloads, setDownloads] = createSignal<readonly PendingDownload[]>([], {
    name: "pendingDownloads",
  });
  const [flyFrom, setFlyFrom] = createSignal<DOMRect>();

  return (
    <main class="flex h-full min-w-0 flex-col gap-8 overflow-hidden p-6">
      <RecoveryBanner />

      <section class="shrink-0 space-y-3">
        <PanelHeader title={t("Projects Loaded into Sefer")} />
        <YourProjects
          downloads={downloads()}
          flyFrom={flyFrom()}
          onDismiss={(id) => setDownloads((held) => held.filter((item) => item.id !== id))}
        />
      </section>

      <WacsProjects
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
