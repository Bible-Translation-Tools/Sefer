import { useNavigate } from "@tanstack/solid-router";
import { For, Show, createEffect, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { Project } from "#core/project/project";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { useShell } from "../../ProjectContext";
import {
  mySuggestions,
  reviewNeeded,
  suggestMyChanges,
  withdrawSuggestion,
  type MySuggestion,
} from "../../suggestions";
import { ago } from "../panels/format";
import { Button, toasts } from "../primitives";
import { offerRefusalCopy } from "./copy";
import { QuietSection } from "./QuietSection";

const statusOf = (mine: MySuggestion): string => {
  switch (mine.kind) {
    case "waiting":
      return m.cloud_waiting_for_the_projects_editors();
    case "taken":
      return m.cloud_brought_into_the_shared_project();
    case "declined":
      return m.cloud_closed_without_being_brought_in();
  }
};

const YourRow = (props: {
  readonly held: MySuggestion;
  readonly busy: boolean;
  readonly withdrawing: boolean;
  readonly onAskWithdraw: () => void;
  readonly onWithdraw: () => void;
  readonly onCancel: () => void;
}) => (
  <li
    class="space-y-1 py-1.5"
    data-suggestion={props.held.suggestion.number}
    data-state={props.held.kind}
  >
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <p class="truncate text-small font-medium text-on-surface-primary">
          {props.held.suggestion.title}
        </p>
        <p class="text-smallest text-on-surface-tertiary">
          <span class={props.held.kind === "taken" ? "text-on-surface-success" : undefined}>
            {statusOf(props.held)}
          </span>
          {" · "}
          {ago(Date.parse(props.held.suggestion.updatedAt))}
        </p>
      </div>
      <Show when={props.held.kind === "waiting"}>
        <Show
          when={props.withdrawing}
          fallback={
            <Button
              size="sm"
              variant="tertiary"
              disabled={props.busy}
              onClick={props.onAskWithdraw}
            >
              {m.cloud_withdraw()}
            </Button>
          }
        >
          <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onWithdraw}>
            {m.cloud_yes_withdraw()}
          </Button>
          <Button size="sm" variant="tertiary" onClick={props.onCancel}>
            {m.common_not_now()}
          </Button>
        </Show>
      </Show>
    </div>
    <Show when={props.held.kind === "waiting" ? undefined : props.held.note}>
      {(note) => (
        <blockquote class="border-s-2 border-surface-border ps-3 text-small break-words text-on-surface-secondary">
          {note()}
        </blockquote>
      )}
    </Show>
  </li>
);

const createYourSuggestions = (props: { readonly project: Project; readonly asked?: number }) => {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
  const [mine, setMine] = createSignal<readonly MySuggestion[] | undefined>(undefined, {
    name: "yourSuggestions",
  });
  const [busy, setBusy] = createSignal(false, { name: "yourSuggestionsBusy" });

  let asked = 0;
  const load = async (project: Project): Promise<void> => {
    const ask = ++asked;
    const held = await mySuggestions(services, project);
    if (ask === asked) setMine(held);
  };
  createEffect(
    () => ({ project: props.project, asked: props.asked }),
    ({ project }) => {
      void load(project);
    },
  );

  const act = (work: Promise<unknown>, done: string, project: Project): void => {
    setBusy(true);
    work
      .then(() => toasts.success({ title: done }))
      .catch((cause: unknown) => {
        const needed = reviewNeeded(cause);
        if (needed !== undefined) {
          toasts.info(offerRefusalCopy(needed));
          void navigate({
            to: "/project/$slug/review",
            params: { slug: shell.slug() },
            search: needed.search,
          });
          return;
        }
        toasts.error({ title: m.cloud_that_did_not_work(), message: describe(cause) });
      })
      .finally(() => {
        setBusy(false);
        void load(project);
        void collaboration.refresh(services, project);
      });
  };
  return { mine, busy, act };
};

const OfferRow = (props: { readonly busy: boolean; readonly onOffer: () => void }) => (
  <div class="flex items-center gap-3 py-1">
    <p class="min-w-0 flex-1 text-small text-on-surface-secondary">
      {m.cloud_your_copy_has_changes_the()}
    </p>
    <Button size="sm" variant="primary" loading={props.busy} onClick={props.onOffer}>
      {m.cloud_offer_my_changes()}
    </Button>
  </div>
);

const NoneYet = (props: { readonly asking: boolean }) => (
  <p class="text-small text-on-surface-tertiary">
    {props.asking ? m.cloud_asking_the_shared_project() : m.cloud_you_have_not_offered_any()}
  </p>
);

export function YourSuggestions(props: { readonly project: Project; readonly asked?: number }) {
  const { services } = useShell();
  const facts = () => collaboration.facts(props.project.root);
  const { mine, busy, act } = createYourSuggestions(props);
  const [withdrawing, setWithdrawing] = createSignal<number | undefined>(undefined, {
    name: "yourSuggestionsWithdrawing",
  });
  const waiting = () => mine()?.some((held) => held.kind === "waiting") === true;

  return (
    <QuietSection
      title={m.cloud_yours()}
      count={mine()?.length}
      note={m.cloud_what_you_offered_from_your()}
      data={{ "data-suggestions": "yours" }}
    >
      <Show when={!waiting() && facts()?.offerable === true}>
        <OfferRow
          busy={busy()}
          onOffer={() =>
            act(
              suggestMyChanges(services, props.project),
              m.cloud_your_changes_are_offered(),
              props.project,
            )
          }
        />
      </Show>

      <Show when={(mine()?.length ?? 0) > 0} fallback={<NoneYet asking={mine() === undefined} />}>
        <ul class="space-y-1">
          <For each={mine()}>
            {(held) => (
              <YourRow
                held={held}
                busy={busy()}
                withdrawing={withdrawing() === held.suggestion.number}
                onAskWithdraw={() => setWithdrawing(held.suggestion.number)}
                onWithdraw={() => {
                  setWithdrawing(undefined);
                  act(
                    withdrawSuggestion(services, props.project, held.suggestion),
                    m.cloud_withdrawn_your_copy_keeps_the(),
                    props.project,
                  );
                }}
                onCancel={() => setWithdrawing(undefined)}
              />
            )}
          </For>
        </ul>
      </Show>
    </QuietSection>
  );
}
