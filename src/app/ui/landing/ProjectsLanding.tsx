import { createSignal, untrack } from "solid-js";

import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { PROJECTS_WIDTH } from "../../settings";
import { PanelHeader, Resizable } from "../primitives";
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

  const shell = useShell();
  // Plain value: Resizable.Panel reads its sizes once, at registration; the split owns the width after.
  const initialWidth = untrack(() => shell.projectsWidth());

  return (
    <main class="flex h-full min-w-0 flex-col gap-6 overflow-hidden p-6">
      <RecoveryBanner />

      {/* Below lg the two stack, and the drag widths give way to the column. */}
      <Resizable.Root
        class="min-h-0 flex-1 max-lg:flex-col max-lg:gap-6"
        onSizesChange={(sizes) => {
          const first = sizes[0];
          if (first !== undefined) shell.setProjectsWidth(first);
        }}
      >
        <Resizable.Panel
          initialSize={initialWidth}
          minSize={PROJECTS_WIDTH.min}
          maxSize={PROJECTS_WIDTH.max}
          class="flex flex-col gap-3 lg:pe-3 max-lg:[flex-basis:auto]! max-lg:overflow-visible"
        >
          <PanelHeader title={t("Projects Loaded into Sefer")} />
          {/* The drop zone scrolls away with the list; only the title stays. */}
          <div class="scrollbar-subtle flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-24">
            <ImportHub variant="drop" />
            <YourProjects
              downloads={downloads()}
              flyFrom={flyFrom()}
              onDismiss={(id) => setDownloads((held) => held.filter((item) => item.id !== id))}
            />
          </div>
        </Resizable.Panel>
        <Resizable.Handle label={m.landing_resize_columns()} class="max-lg:hidden" />
        <Resizable.Panel class="flex flex-col lg:ps-3 max-lg:[flex-basis:auto]! max-lg:flex-1">
          <WacsProjects
            downloads={{
              start: (download, from) => {
                setFlyFrom(from);
                setDownloads((held) => [
                  download,
                  ...held.filter((item) => item.id !== download.id),
                ]);
              },
              update: (id, patch) =>
                setDownloads((held) =>
                  held.map((item) => (item.id === id ? { ...item, ...patch } : item)),
                ),
            }}
          />
        </Resizable.Panel>
      </Resizable.Root>
    </main>
  );
}
