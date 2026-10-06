/**
 * Your suggestions, in the Suggestions tab: what you offered from your own
 * copy, how each stands — waiting, brought in, or closed with the editor's
 * note — and the two moves that are yours: offer what your copy has that the
 * shared project does not, and withdraw a suggestion still waiting.
 */

import { For, Show, createEffect, createSignal } from "solid-js";

import type { Project } from "#core/project/project";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  mySuggestions,
  suggestMyChanges,
  withdrawSuggestion,
  type MySuggestion,
} from "../../suggestions";
import { ago } from "../panels/format";
import { Button, Card, PanelHeader, toasts } from "../primitives";

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

export function YourSuggestions(props: { readonly project: Project }) {
  const shell = useShell();
  const { services } = shell;
  const facts = () => collaboration.facts(props.project.root);
  const [mine, setMine] = createSignal<readonly MySuggestion[] | undefined>(undefined, {
    name: "yourSuggestions",
  });
  const [busy, setBusy] = createSignal(false, { name: "yourSuggestionsBusy" });
  const [withdrawing, setWithdrawing] = createSignal<number | undefined>(undefined, {
    name: "yourSuggestionsWithdrawing",
  });

  /** Only the newest load writes, so a slow answer never lands over a newer one. */
  let asked = 0;
  const load = async (project: Project): Promise<void> => {
    const ask = ++asked;
    const held = await mySuggestions(services, project);
    if (ask === asked) setMine(held);
  };
  createEffect(
    () => props.project,
    (project) => {
      void load(project);
    },
  );

  /** One press: the work started in the handler; afterwards everything reads again. */
  const act = (work: Promise<unknown>, done: string, project: Project): void => {
    setBusy(true);
    work
      .then(() => toasts.success({ title: done }))
      .catch((cause: unknown) =>
        toasts.error({ title: t("That did not work"), message: describe(cause) }),
      )
      .finally(() => {
        setBusy(false);
        void load(project);
        void collaboration.refresh(services, project);
      });
  };

  const waiting = () => mine()?.some((held) => held.kind === "waiting") === true;

  return (
    <Card class="space-y-3" data-suggestions="yours">
      <PanelHeader
        level={3}
        title={t("Yours")}
        subtitle={t("What you offered from your own copy. Later sends add to an open suggestion.")}
      />

      <Show when={!waiting() && facts()?.offerable === true}>
        <div class="flex items-center gap-3 rounded-md bg-surface-secondary px-3 py-2">
          <p class="min-w-0 flex-1 text-small text-on-surface-secondary">
            {t("Your copy has changes the shared project does not.")}
          </p>
          <Button
            size="sm"
            variant="primary"
            loading={busy()}
            onClick={() =>
              act(
                suggestMyChanges(services, props.project, t("Suggested changes")),
                t("Your changes are offered"),
                props.project,
              )
            }
          >
            {t("Offer my changes")}
          </Button>
        </div>
      </Show>

      <Show
        when={(mine()?.length ?? 0) > 0}
        fallback={
          <p class="text-small text-on-surface-tertiary">
            {mine() === undefined
              ? t("Asking the shared project…")
              : t("You have not offered any yet.")}
          </p>
        }
      >
        <ul class="divide-y divide-surface-border">
          <For each={mine()}>
            {(held) => (
              <li
                class="space-y-1 py-2"
                data-suggestion={held.suggestion.number}
                data-state={held.kind}
              >
                <div class="flex items-center gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="text-small">
                      {held.suggestion.title}
                      <span class="text-on-surface-tertiary">
                        {" "}
                        · {ago(Date.parse(held.suggestion.updatedAt))}
                      </span>
                    </p>
                    <p
                      class={
                        held.kind === "taken"
                          ? "text-smallest text-on-surface-success"
                          : "text-smallest text-on-surface-secondary"
                      }
                    >
                      {statusOf(held)}
                    </p>
                  </div>
                  <Show when={held.kind === "waiting"}>
                    <Show
                      when={withdrawing() === held.suggestion.number}
                      fallback={
                        <Button
                          size="sm"
                          variant="tertiary"
                          disabled={busy()}
                          onClick={() => setWithdrawing(held.suggestion.number)}
                        >
                          {t("Withdraw")}
                        </Button>
                      }
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy()}
                        onClick={() => {
                          setWithdrawing(undefined);
                          act(
                            withdrawSuggestion(services, props.project, held.suggestion),
                            t("Withdrawn — your copy keeps the changes"),
                            props.project,
                          );
                        }}
                      >
                        {t("Yes, withdraw")}
                      </Button>
                      <Button
                        size="sm"
                        variant="tertiary"
                        onClick={() => setWithdrawing(undefined)}
                      >
                        {t("Not now")}
                      </Button>
                    </Show>
                  </Show>
                </div>
                <Show when={held.kind === "declined" ? held.note : undefined}>
                  {(note) => (
                    <blockquote class="border-s-2 border-surface-border ps-3 text-small break-words text-on-surface-secondary">
                      {note()}
                    </blockquote>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Card>
  );
}
