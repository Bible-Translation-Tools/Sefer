/**
 * The suggestions waiting for an editor: for someone who can write to the
 * shared project, each one to review (in Review, against the suggestion) or
 * to decline with a note its author reads.
 *
 * Shows nothing to anyone else. The author's side — their copy, offering
 * their changes, how their suggestion stands — is the cloud popover's. Its
 * logic is `src/app/suggestions.ts`; this is the words and buttons.
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
  openSuggestions,
} from "../../suggestions";
import { Button, Card, Input, PanelHeader, toasts } from "../primitives";

export function SuggestionsCard(props: { readonly project: Project; readonly signedIn: boolean }) {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
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
  const [note, setNote] = createSignal("", { name: "suggestionsDeclineNote" });

  /**
   * The project is a parameter, not a read: this runs from promise
   * continuations. Only the newest load writes, so an answer about a project
   * that has since been left never lands on the next one's card.
   */
  let asked = 0;
  const load = async (project: Project, signedIn: boolean): Promise<void> => {
    const mine = ++asked;
    const canWrite = signedIn ? await canWriteShared(services, project) : undefined;
    const waiting = canWrite === true ? await openSuggestions(services, project) : [];
    if (mine !== asked) return;
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
    <Show when={props.signedIn && writer() === true}>
      <Card class="space-y-3" data-cloud-card="suggestions">
        <PanelHeader
          level={3}
          title={t("To review ({count})", { count: waiting().length })}
          subtitle={t(
            "From people working in their own copy. The shared project only changes when you accept.",
          )}
        />
        <Show
          when={waiting().length > 0}
          fallback={<p class="text-small text-on-surface-secondary">{t("Nothing is waiting.")}</p>}
        >
          <ul class="space-y-3">
            <For each={waiting()}>
              {(suggestion) => (
                <li class="space-y-2" data-suggestion={suggestion.number}>
                  <div class="flex items-center justify-between gap-3">
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
                      <Show when={declining() !== suggestion.number}>
                        <Button
                          size="sm"
                          variant="tertiary"
                          disabled={busy()}
                          onClick={() => {
                            setNote("");
                            setDeclining(suggestion.number);
                          }}
                        >
                          {t("Decline")}
                        </Button>
                      </Show>
                    </span>
                  </div>
                  <Show when={declining() === suggestion.number}>
                    <form
                      class="flex flex-wrap items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        setDeclining(undefined);
                        act(
                          declineSuggestion(services, props.project, suggestion, note()),
                          t("Declined"),
                          props.project,
                          props.signedIn,
                        );
                      }}
                    >
                      <Input
                        size="sm"
                        wrapperClass="min-w-0 flex-1"
                        placeholder={t("Why? {author} will read this.", {
                          author: suggestion.author,
                        })}
                        value={note()}
                        onInput={(event) => setNote(event.currentTarget.value)}
                      />
                      <Button size="sm" type="submit" disabled={busy()}>
                        {t("Decline")}
                      </Button>
                      <Button size="sm" variant="tertiary" onClick={() => setDeclining(undefined)}>
                        {t("Not now")}
                      </Button>
                    </form>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Card>
    </Show>
  );
}
