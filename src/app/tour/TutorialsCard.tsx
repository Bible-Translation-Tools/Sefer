import { For } from "solid-js";

import { t } from "../i18n";
import { useShell } from "../ProjectContext";
import { Button, Card, PanelHeader } from "../ui/primitives";
import { beginTour, type Tour } from "./machine";
import { useTourContext } from "./TourOutlet";
import { TOURS } from "./tours";

const HEADINGS: Record<Tour["kind"], { readonly title: string; readonly subtitle: string }> = {
  tutorial: {
    title: "Tutorials",
    subtitle: "Short guided tours of one part of Sefer, on your own project.",
  },
  workflow: {
    title: "Workflows",
    subtitle:
      "Sefer takes you through one kind of work, place by place, moving on as each is done. Also in the command palette.",
  },
};

export function TutorialsCard(props: { readonly kind: Tour["kind"] }) {
  const shell = useShell();
  const context = useTourContext();
  const heading = () => HEADINGS[props.kind];
  return (
    <Card class="space-y-1" data-settings-group={`${props.kind}s`}>
      <PanelHeader level={3} title={t(heading().title)} subtitle={t(heading().subtitle)} />
      <div class="divide-y divide-surface-border">
        <For each={TOURS.filter((tour) => tour.kind === props.kind)}>
          {(tour) => (
            <div class="flex items-center gap-6 py-3" data-tutorial={tour.id}>
              <div class="min-w-0 flex-1">
                <p class="text-small font-medium text-on-surface-primary">{t(tour.title)}</p>
                <p class="text-smallest text-on-surface-tertiary">{t(tour.summary)}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={
                  tour.needsProject && tour.start === undefined && shell.project() === undefined
                }
                onClick={() => beginTour(context, tour)}
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
