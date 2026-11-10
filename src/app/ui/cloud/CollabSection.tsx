import { useNavigate } from "@tanstack/solid-router";
import { Match, Show, Switch, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { useShell, type Shell } from "../../ProjectContext";
import { reviewNeeded, suggestMyChanges } from "../../suggestions";
import { ago } from "../panels/format";
import { Button, toasts } from "../primitives";
import { chooseShared } from "./collab";
import { offerRefusalCopy } from "./copy";

type Facts = NonNullable<ReturnType<typeof collaboration.facts>>;
type Project = NonNullable<ReturnType<Shell["project"]>>;
type ReviewSearch = NonNullable<ReturnType<typeof reviewNeeded>>["search"];

const speaks = (held: Facts | undefined): Facts | undefined => {
  if (held === undefined) return undefined;
  const speaking =
    held.mode === "copy" ||
    // No permission is the popover's own note and its Submit changes button,
    // so this section doesn't say it a second time.
    (held.mode === "shared" && held.canWrite !== false && held.waiting > 0);
  return speaking ? held : undefined;
};

const offerChanges = async (
  services: Shell["services"],
  project: Project,
  toReview: (search: ReviewSearch) => void,
): Promise<void> => {
  try {
    await suggestMyChanges(services, project);
    toasts.success({
      title: m.cloud_your_changes_are_offered(),
      message: m.cloud_the_projects_editors_will_see(),
    });
  } catch (cause) {
    const needed = reviewNeeded(cause);
    if (needed === undefined)
      toasts.error({ title: m.common_could_not_offer_your_changes(), message: describe(cause) });
    else {
      toasts.info(offerRefusalCopy(needed));
      toReview(needed.search);
    }
  } finally {
    await collaboration.refresh(services, project);
  }
};

const createCollabActions = (onLeave: () => void) => {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
  const facts = () => collaboration.facts(shell.project()?.root);
  const [busy, setBusy] = createSignal(false, { name: "collabBusy" });

  const press = (work: (project: Project) => Promise<unknown>) => {
    const project = shell.project();
    if (project === undefined || busy()) return;
    setBusy(true);
    void work(project).finally(() => setBusy(false));
  };

  const toReview = (search: ReviewSearch): void => {
    onLeave();
    void navigate({ to: "/project/$slug/review", params: { slug: shell.slug() }, search });
  };

  return {
    facts,
    busy,
    offer: (): void => press((project) => offerChanges(services, project, toReview)),
    workDirectly: (): void => press((project) => chooseShared(services, project)),
    toReview,
    toSuggestions: (): void => {
      onLeave();
      void navigate({ to: "/project/$slug/suggestions", params: { slug: shell.slug() } });
    },
  };
};

const WaitingNote = (props: { readonly waiting: number; readonly onSee: () => void }) => (
  <div class="flex items-center gap-2">
    <p class="min-w-0 flex-1 text-small text-on-surface-secondary">
      {props.waiting === 1
        ? m.cloud_1_suggestion_is_waiting_for()
        : m.cloud_count_suggestions_are_waiting_for({
            count: props.waiting,
          })}
    </p>
    <Button size="sm" variant="secondary" onClick={props.onSee}>
      {m.cloud_see_them()}
    </Button>
  </div>
);

const MineNote = (props: { readonly held: Facts }) => (
  <Switch
    fallback={
      <p class="text-small text-on-surface-secondary">{m.cloud_offer_your_changes_when_they()}</p>
    }
  >
    <Match when={props.held.mine?.kind === "waiting" ? props.held.mine : undefined}>
      {(mine) => (
        <p class="text-small text-on-surface-secondary" data-sync-suggestion="waiting">
          {m.cloud_your_suggestion_is_waiting_for({
            when: ago(Date.parse(mine().suggestion.updatedAt)),
          })}
        </p>
      )}
    </Match>
    <Match when={props.held.mine?.kind === "taken"}>
      <p class="text-small text-on-surface-success" data-sync-suggestion="taken">
        {m.cloud_your_last_suggestion_was_brought()}
      </p>
    </Match>
    <Match
      when={(() => {
        const mine = props.held.mine;
        return mine?.kind === "declined" ? mine : undefined;
      })()}
    >
      {(mine) => (
        <div class="space-y-1" data-sync-suggestion="declined">
          <p class="text-small text-on-surface-secondary">
            {m.cloud_your_last_suggestion_was_closed()}
          </p>
          <Show when={mine().note}>
            {(note) => (
              <blockquote class="border-s-2 border-surface-border ps-3 text-small break-words text-on-surface-secondary">
                {note()}
              </blockquote>
            )}
          </Show>
        </div>
      )}
    </Match>
  </Switch>
);

const CopyMode = (props: {
  readonly held: Facts;
  readonly busy: boolean;
  readonly onSee: () => void;
  readonly onOffer: () => void;
  readonly onWorkDirectly: () => void;
}) => (
  <>
    <p class="text-small font-semibold">{m.cloud_youre_working_in_your_own()}</p>
    <Show when={props.held.copyAhead}>
      <div class="flex items-center gap-2" data-sync-copy="ahead">
        <p class="min-w-0 flex-1 text-small text-on-surface-secondary">
          {m.cloud_your_copy_has_changes_this()}
        </p>
        <Button size="sm" variant="primary" onClick={props.onSee}>
          {m.cloud_see_the_changes()}
        </Button>
      </div>
    </Show>
    <MineNote held={props.held} />
    <div class="flex flex-wrap items-center gap-2">
      <Show when={props.held.mine?.kind !== "waiting" && props.held.offerable}>
        <Button size="sm" variant="secondary" loading={props.busy} onClick={props.onOffer}>
          {m.cloud_offer_my_changes()}
        </Button>
      </Show>
      <Show when={props.held.canWrite === true}>
        <span class="min-w-0 flex-1 text-smallest text-on-surface-tertiary">
          {m.cloud_you_can_now_work_directly()}
        </span>
        <Button size="sm" variant="tertiary" disabled={props.busy} onClick={props.onWorkDirectly}>
          {m.cloud_work_directly()}
        </Button>
      </Show>
    </div>
  </>
);

export function CollabSection(props: { readonly onLeave: () => void }) {
  const actions = createCollabActions(() => props.onLeave());
  const said = () => speaks(actions.facts());

  return (
    <Show when={said()}>
      {(held) => (
        <div class="space-y-2 border-t border-surface-border pt-3" data-sync-collab={held().mode}>
          <Switch>
            <Match when={held().mode === "shared" && held().waiting > 0}>
              <WaitingNote waiting={held().waiting} onSee={actions.toSuggestions} />
            </Match>

            <Match when={held().mode === "copy"}>
              <CopyMode
                held={held()}
                busy={actions.busy()}
                onSee={() => actions.toReview({ against: "shared", copy: 1 })}
                onOffer={actions.offer}
                onWorkDirectly={actions.workDirectly}
              />
            </Match>
          </Switch>
        </div>
      )}
    </Show>
  );
}
