/**
 * Your suggestions, in the Suggestions tab: what you offered from your own
 * copy, how each stands — waiting, brought in, or closed — with what the
 * editor wrote on it either way, and the two moves that are yours: offer what
 * your copy has that the shared project does not, and withdraw a suggestion
 * still waiting. "Brought in" is read from Sefer's own line at the end of the
 * editor's note (`mySuggestions`), not from git.
 */

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

export function YourSuggestions(props: {
  readonly project: Project;
  /** Moves when the page's refresh is pressed: read the list again. */
  readonly asked?: number;
}) {
  const shell = useShell();
  const navigate = useNavigate();
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
    () => ({ project: props.project, asked: props.asked }),
    ({ project }) => {
      void load(project);
    },
  );

  /** One press: the work started in the handler; afterwards everything reads again. */
  const act = (work: Promise<unknown>, done: string, project: Project): void => {
    setBusy(true);
    work
      .then(() => toasts.success({ title: done }))
      .catch((cause: unknown) => {
        // Work this device lacks is in the way: not a failure, one decision.
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

  const waiting = () => mine()?.some((held) => held.kind === "waiting") === true;

  return (
    <QuietSection
      title={t("Yours")}
      count={mine()?.length}
      note={t("What you offered from your own copy. Later sends add to an open suggestion.")}
      data={{ "data-suggestions": "yours" }}
    >
      <Show when={!waiting() && facts()?.offerable === true}>
        <div class="flex items-center gap-3 py-1">
          <p class="min-w-0 flex-1 text-small text-on-surface-secondary">
            {t("Your copy has changes the shared project does not.")}
          </p>
          <Button
            size="sm"
            variant="primary"
            loading={busy()}
            onClick={() =>
              act(
                suggestMyChanges(services, props.project),
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
        <ul class="space-y-1">
          <For each={mine()}>
            {(held) => (
              <li
                class="space-y-1 py-1.5"
                data-suggestion={held.suggestion.number}
                data-state={held.kind}
              >
                <div class="flex items-center gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-small font-medium text-on-surface-primary">
                      {held.suggestion.title}
                    </p>
                    <p class="text-smallest text-on-surface-tertiary">
                      <span class={held.kind === "taken" ? "text-on-surface-success" : undefined}>
                        {statusOf(held)}
                      </span>
                      {" · "}
                      {ago(Date.parse(held.suggestion.updatedAt))}
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
                <Show when={held.kind === "waiting" ? undefined : held.note}>
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
    </QuietSection>
  );
}
