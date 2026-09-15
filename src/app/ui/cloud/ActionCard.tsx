/**
 * One button, and a sentence saying what it will do.
 *
 * Every state has exactly one right next move — `primaryActionOf` in
 * `src/core/sync` decides which — and this card shows that one, as the
 * primary. The alternative, a row of Push / Pull / Fetch / Publish with three
 * of them disabled, is a git UI wearing a hat: it asks the person to work out
 * which verb applies, which is the job the state machine just did.
 *
 * Under the button is one sentence naming what moves and what does not. It is
 * never generic — the counts come from the clocks — because a vague promise is
 * what makes people afraid to press a sync button.
 *
 * `Pull` is the one action that does not fire on the first press: it is
 * `confirm`-gated on the plan above it, so nothing is applied before the
 * translator has read what is arriving.
 */

import { Show } from "solid-js";

import type { IncomingPlan, Sync } from "../../../core/sync";
import { t } from "../../i18n";
import { Button, Card, PanelHeader } from "../primitives";
import { actionLabel, narrate } from "./copy";
import { compareHref } from "./IncomingPlanCard";

export interface ActionCardProps {
  readonly sync: Sync;
  readonly plan: IncomingPlan;
  readonly host: string;
  readonly busy: boolean;
  /** The transfer's live phase line, or `""` when nothing is moving. */
  readonly phase: string;
  readonly onRun: () => void;
  /** Shown under the button when the last attempt failed. */
  readonly problem: string;
}

/**
 * The primary button's look, on an anchor.
 *
 * `Button` renders a `<button>` and has no `as` prop, and Compare is a
 * NAVIGATION — it must be a real link, so middle-click and "open in a new tab"
 * work and so the path is visible in the status bar. Tailwind scans source
 * text, so the classes have to be a literal; this is the one place they are
 * repeated, and `Button.tsx` is where they are defined.
 */
const PRIMARY_LINK = [
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3.5",
  "text-small font-medium whitespace-nowrap transition-colors select-none",
  "border-button-primary-surface bg-button-primary-surface text-button-primary-on-surface",
  "hover:bg-button-primary-surface-hover",
].join(" ");

export function ActionCard(props: ActionCardProps) {
  const counts = () => ({
    ahead: props.sync.clocks.local.unshared,
    behind: props.sync.clocks.shared.unshared,
    contested: props.plan.contested.length,
  });
  const action = () => props.sync.primary;
  /** Compare is a navigation, not a transfer: it gets a link, not a handler. */
  const compareTo = () => (action() === "compare" ? props.plan.contested[0] : undefined);

  return (
    <Card class="space-y-3" data-cloud-card="action" data-action={action()}>
      <PanelHeader level={3} title={t("What happens next")} />

      <div class="flex flex-wrap items-center gap-3">
        <Show
          when={compareTo()}
          fallback={
            <Button
              variant="primary"
              disabled={props.busy}
              loading={props.busy}
              onClick={props.onRun}
              data-cloud-primary={action()}
            >
              {actionLabel(action())}
            </Button>
          }
        >
          {(book) => (
            <a class={PRIMARY_LINK} href={compareHref(book())} data-cloud-primary="compare">
              {actionLabel("compare")}
            </a>
          )}
        </Show>

        <Show when={props.phase !== ""}>
          <span class="text-small text-on-surface-tertiary" data-cloud="progress">
            {props.phase}
          </span>
        </Show>
      </div>

      <p class="text-small text-on-surface-secondary" data-cloud="narrative">
        {narrate(action(), counts(), props.host)}
      </p>

      <Show when={action() === "combine"}>
        <p class="rounded-md bg-surface-secondary px-3 py-2 text-small text-on-surface-secondary">
          {t(
            "Combine means: keep my work as one version on top of the shared project's. The shared project's versions stay exactly as they are, yours are replayed above them, and no scripture text is merged line by line.",
          )}
        </p>
      </Show>

      <Show when={props.problem !== ""}>
        <p
          class="rounded-md bg-surface-error px-3 py-2 text-small break-words text-on-surface-error"
          data-cloud="action-problem"
        >
          {props.problem}
        </p>
      </Show>
    </Card>
  );
}
