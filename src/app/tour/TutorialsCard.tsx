import { For, Show } from "solid-js";

import { m } from "#app/paraglide/messages";

import type { Message } from "../i18n";
import { useShell } from "../ProjectContext";
import { Button, Card, PanelHeader } from "../ui/primitives";
import { beginTour, type Tour } from "./machine";
import { useTourContext } from "./TourOutlet";
import { TOURS } from "./tours";

const HEADINGS: Record<Tour["kind"], { readonly title: Message; readonly subtitle: Message }> = {
  tutorial: {
    title: m.tour_tutorials,
    subtitle: m.tour_short_guided_tours_of_one,
  },
  workflow: {
    title: m.tour_workflows,
    subtitle: m.tour_sefer_takes_you_through_one,
  },
};

export function TutorialsCard(props: { readonly kind: Tour["kind"] }) {
  const shell = useShell();
  const context = useTourContext();
  const heading = () => HEADINGS[props.kind];
  const listed = () => TOURS.filter((tour) => tour.kind === props.kind);
  return (
    <Show when={listed().length > 0}>
      <Card class="space-y-1" data-settings-group={`${props.kind}s`}>
        <PanelHeader level={3} title={heading().title()} subtitle={heading().subtitle()} />
        <div class="divide-y divide-surface-border">
          <For each={listed()}>
            {(tour) => (
              <div class="flex items-center gap-6 py-3" data-tutorial={tour.id}>
                <div class="min-w-0 flex-1">
                  <p class="text-small font-medium text-on-surface-primary">{tour.title()}</p>
                  <p class="text-smallest text-on-surface-tertiary">{tour.summary()}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    tour.needsProject && tour.start === undefined && shell.project() === undefined
                  }
                  onClick={() => beginTour(context, tour)}
                >
                  {m.tour_start()}
                </Button>
              </div>
            )}
          </For>
        </div>
      </Card>
    </Show>
  );
}
