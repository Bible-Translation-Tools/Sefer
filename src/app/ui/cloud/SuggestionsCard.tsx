import { useNavigate } from "@tanstack/solid-router";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { Project } from "#core/project/project";
import type { Suggestion } from "#core/remote/suggestions";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  canWriteShared,
  declineSuggestion,
  fetchSuggestion,
  openSuggestions,
} from "../../suggestions";
import { ago } from "../panels/format";
import { Button, Input, toasts } from "../primitives";
import { QuietSection } from "./QuietSection";

export function SuggestionsCard(props: {
  readonly project: Project;
  readonly signedIn: boolean;
  readonly asked?: number;
}) {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
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

  let asked = 0;
  const load = async (project: Project, signedIn: boolean): Promise<void> => {
    const mine = ++asked;
    const canWrite = signedIn ? await canWriteShared(services, project) : undefined;
    const waiting = canWrite === true ? await openSuggestions(services, project) : [];
    if (mine !== asked) return;
    setWriter(canWrite);
    setWaiting(waiting);
  };
  createEffect(
    () => ({ project: props.project, signedIn: props.signedIn, asked: props.asked }),
    ({ project, signedIn }) => {
      void load(project, signedIn);
    },
  );

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
        void collaboration.refresh(services, project);
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
      <QuietSection
        title={t("To review")}
        count={waiting().length}
        note={t(
          "From people working in their own copy. The shared project only changes when you accept.",
        )}
        data={{ "data-cloud-card": "suggestions" }}
      >
        <Show
          when={waiting().length > 0}
          fallback={<p class="text-small text-on-surface-tertiary">{t("Nothing is waiting.")}</p>}
        >
          <ul class="space-y-1">
            <For each={waiting()}>
              {(suggestion) => (
                <li class="space-y-2 py-1.5" data-suggestion={suggestion.number}>
                  <div class="flex items-center justify-between gap-3">
                    <span class="min-w-0">
                      <span class="block truncate text-small font-medium text-on-surface-primary">
                        {suggestion.title}
                      </span>
                      <span class="block text-smallest text-on-surface-tertiary">
                        {suggestion.author} · {ago(Date.parse(suggestion.updatedAt))}
                      </span>
                    </span>
                    <span class="flex shrink-0 gap-1">
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
      </QuietSection>
    </Show>
  );
}
