/**
 * Suggested changes on /cloud: the translator's own copy and their
 * suggestion, and — for someone who can write to the shared project — the
 * suggestions waiting to be brought in.
 *
 * Shows only what applies: nothing at all for a translator who writes to the
 * shared project directly, which is the whole point of the flow being one
 * card. Its logic is `src/app/suggestions.ts`; this is the words and buttons.
 */
import { useNavigate } from "@tanstack/solid-router";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { Project } from "#core/project/project";
import type { Suggestion } from "#core/remote/suggestions";

import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  canWriteShared,
  declineSuggestion,
  fetchSuggestion,
  hasOwnCopy,
  makeOwnCopy,
  openSuggestions,
  suggestMyChanges,
} from "../../suggestions";
import { Button, Card, PanelHeader, toasts } from "../primitives";

export function SuggestionsCard(props: { readonly project: Project; readonly signedIn: boolean }) {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
  const [ownCopy, setOwnCopy] = createSignal(false, { name: "suggestionsOwnCopy" });
  /** True, false, or unknown — no shared project, or it could not be asked. */
  const [writer, setWriter] = createSignal<boolean | undefined>(undefined, {
    name: "suggestionsWriter",
  });
  const [waiting, setWaiting] = createSignal<readonly Suggestion[]>([], {
    name: "suggestionsWaiting",
  });
  const [declining, setDeclining] = createSignal<number | undefined>(undefined, {
    name: "suggestionsDeclining",
  });
  const [busy, setBusy] = createSignal(false, { name: "suggestionsBusy" });

  /**
   * The project is a parameter, not a read: this runs from promise
   * continuations. Only the newest load writes, so an answer about a project
   * that has since been left never lands on the next one's card.
   */
  let asked = 0;
  const load = async (project: Project, signedIn: boolean): Promise<void> => {
    const mine = ++asked;
    const ownCopy = await hasOwnCopy(services, project);
    const canWrite = signedIn ? await canWriteShared(services, project) : undefined;
    const waiting = canWrite === true ? await openSuggestions(services, project) : [];
    if (mine !== asked) return;
    setOwnCopy(ownCopy);
    setWriter(canWrite);
    setWaiting(waiting);
  };
  // On mount, and again for a different project; `load` reads the project as
  // a parameter-free call, so the key is what is tracked.
  createEffect(
    () => ({ project: props.project, signedIn: props.signedIn }),
    ({ project, signedIn }) => {
      void load(project, signedIn);
    },
  );

  /** One press: `work` has already started, in the event handler that read the props. */
  const act = (work: Promise<unknown>, done: string, project: Project, signedIn: boolean): void => {
    setBusy(true);
    work
      .then(() => toasts.success({ title: done }))
      .catch((cause: unknown) =>
        toasts.error({ title: t("That did not work"), message: describe(cause) }),
      )
      .finally(() => {
        setBusy(false);
        void load(project, signedIn);
      });
  };

  const review = (suggestion: Suggestion): void => {
    setBusy(true);
    fetchSuggestion(services, props.project, suggestion)
      .then(() =>
        navigate({
          to: "/project/$slug/review",
          params: { slug: shell.slug() },
          search: { against: "shared", pull: suggestion.number },
        }),
      )
      .catch((cause: unknown) =>
        toasts.error({ title: t("Could not open the suggestion"), message: describe(cause) }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Show when={props.signedIn}>
      <Card class="space-y-3" data-cloud-card="suggestions">
        <Show when={ownCopy()}>
          <PanelHeader level={3} title={t("Your own copy")} />
          <p class="text-small text-on-surface-secondary">
            {t(
              "Your changes go to your own copy of the shared project. When they are ready, suggest them, and someone who looks after the shared project can bring them in.",
            )}
          </p>
          <Button
            variant="secondary"
            disabled={busy()}
            onClick={() =>
              act(
                suggestMyChanges(services, props.project, t("Suggested changes")),
                t("Your changes are suggested"),
                props.project,
                props.signedIn,
              )
            }
          >
            {t("Suggest my changes")}
          </Button>
        </Show>

        <Show when={!ownCopy() && writer() === false}>
          <PanelHeader level={3} title={t("Can't send to the shared project?")} />
          <p class="text-small text-on-surface-secondary">
            {t(
              "If this account can't write to the shared project, make your own copy of it: your changes are sent there, and you can suggest them when they are ready.",
            )}
          </p>
          <Button
            variant="secondary"
            disabled={busy()}
            onClick={() =>
              act(
                makeOwnCopy(services, props.project),
                t("Your own copy is ready, and your changes are in it"),
                props.project,
                props.signedIn,
              )
            }
          >
            {t("Make my own copy")}
          </Button>
        </Show>

        <Show when={writer() === true}>
          <PanelHeader
            level={3}
            title={t("Suggested changes ({count})", { count: waiting().length })}
          />
          <Show
            when={waiting().length > 0}
            fallback={
              <p class="text-small text-on-surface-secondary">{t("Nothing is waiting.")}</p>
            }
          >
            <ul class="space-y-2">
              <For each={waiting()}>
                {(suggestion) => (
                  <li class="flex items-center justify-between gap-3">
                    <span class="text-small">
                      {t("{author} suggested changes", { author: suggestion.author })}
                      <span class="text-on-surface-tertiary">
                        {" "}
                        — {new Date(suggestion.updatedAt).toLocaleDateString()}
                      </span>
                    </span>
                    <span class="flex gap-2">
                      <Button size="sm" disabled={busy()} onClick={() => review(suggestion)}>
                        {t("Review")}
                      </Button>
                      <Show
                        when={declining() === suggestion.number}
                        fallback={
                          <Button
                            size="sm"
                            variant="tertiary"
                            disabled={busy()}
                            onClick={() => setDeclining(suggestion.number)}
                          >
                            {t("Decline")}
                          </Button>
                        }
                      >
                        <Button
                          size="sm"
                          variant="tertiary"
                          disabled={busy()}
                          onClick={() => {
                            setDeclining(undefined);
                            act(
                              declineSuggestion(services, props.project, suggestion, ""),
                              t("Declined"),
                              props.project,
                              props.signedIn,
                            );
                          }}
                        >
                          {t("Yes, decline")}
                        </Button>
                      </Show>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Card>
    </Show>
  );
}
