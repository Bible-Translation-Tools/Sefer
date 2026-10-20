import { useNavigate } from "@tanstack/solid-router";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { Project } from "#core/project/project";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { t } from "../../i18n";
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
      return t("Waiting for the project's editors");
    case "taken":
      return t("Brought into the shared project");
    case "declined":
      return t("Closed without being brought in");
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
              {t("Withdraw")}
            </Button>
          }
        >
          <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onWithdraw}>
            {t("Yes, withdraw")}
          </Button>
          <Button size="sm" variant="tertiary" onClick={props.onCancel}>
            {t("Not now")}
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
        toasts.error({ title: t("That did not work"), message: describe(cause) });
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
      {t("Your copy has changes the shared project does not.")}
    </p>
    <Button size="sm" variant="primary" loading={props.busy} onClick={props.onOffer}>
      {t("Offer my changes")}
    </Button>
  </div>
);

const NoneYet = (props: { readonly asking: boolean }) => (
  <p class="text-small text-on-surface-tertiary">
    {props.asking ? t("Asking the shared project…") : t("You have not offered any yet.")}
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
      title={t("Yours")}
      count={mine()?.length}
      note={t("What you offered from your own copy. Later sends add to an open suggestion.")}
      data={{ "data-suggestions": "yours" }}
    >
      <Show when={!waiting() && facts()?.offerable === true}>
        <OfferRow
          busy={busy()}
          onOffer={() =>
            act(
              suggestMyChanges(services, props.project),
              t("Your changes are offered"),
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
                    t("Withdrawn — your copy keeps the changes"),
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
