import { createSignal } from "solid-js";

import { t } from "../../i18n";
import { PanelHeader } from "../primitives";
import { RecoveryBanner } from "../recovery/RecoveryBanner";
import type { PendingDownload } from "./downloads";
import { ImportHub } from "./ImportHub";
import { WacsProjects } from "./WacsProjects";
import { YourProjects } from "./YourProjects";

export function ProjectsLanding() {
  const [downloads, setDownloads] = createSignal<readonly PendingDownload[]>([], {
    name: "pendingDownloads",
  });
  const [flyFrom, setFlyFrom] = createSignal<DOMRect>();

  return (
    <main class="flex h-full min-w-0 flex-col gap-6 overflow-hidden p-6">
      <RecoveryBanner />

      <div class="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
        <section class="flex min-h-0 shrink-0 flex-col gap-3 lg:w-96">
          <PanelHeader title={t("Projects Loaded into Sefer")} />
          <ImportHub variant="drop" />
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
      </div>
    </main>
  );
}
