import { For } from "solid-js";

import { t } from "../i18n";
import { useShell } from "../ProjectContext";
import { Button, Card, PanelHeader } from "../ui/primitives";
import { startTour } from "./machine";
import { useTourContext } from "./TourOutlet";
import { TOURS } from "./tours";

/** Settings' list of tutorials, each with its own Start. */
export function TutorialsCard() {
  const shell = useShell();
  const context = useTourContext();
  return (
    <Card class="space-y-1" data-settings-group="tutorials">
      <PanelHeader
        level={3}
        title={t("Tutorials")}
        subtitle={t("Short guided tours of one part of Sefer, on your own project.")}
      />
      <div class="divide-y divide-surface-border">
        <For each={TOURS}>
          {(tour) => (
            <div class="flex items-center gap-6 py-3" data-tutorial={tour.id}>
              <div class="min-w-0 flex-1">
                <p class="text-small font-medium text-on-surface-primary">{t(tour.title)}</p>
                <p class="text-smallest text-on-surface-tertiary">{t(tour.summary)}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={tour.needsProject && shell.project() === undefined}
                onClick={() => startTour(context, tour)}
              >
                {t("Start")}
              </Button>
            </div>
          )}
        </For>
      </div>
    </Card>
  );
}
