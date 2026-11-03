import { useNavigate } from "@tanstack/solid-router";
import { For, Show, createEffect, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { Project } from "#core/project/project";
import type { Suggestion } from "#core/remote/suggestions";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
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

const SuggestionRow = (props: {
  readonly suggestion: Suggestion;
  readonly busy: boolean;
  readonly declining: boolean;
  readonly note: string;
  readonly onReview: () => void;
  readonly onStartDecline: () => void;
  readonly onNote: (value: string) => void;
  readonly onDecline: () => void;
  readonly onCancel: () => void;
}) => (
  <li class="space-y-2 py-1.5" data-suggestion={props.suggestion.number}>
    <div class="flex items-center justify-between gap-3">
      <span class="min-w-0">
        <span class="block truncate text-small font-medium text-on-surface-primary">
          {props.suggestion.title}
        </span>
        <span class="block text-smallest text-on-surface-tertiary">
          {props.suggestion.author} · {ago(Date.parse(props.suggestion.updatedAt))}
        </span>
      </span>
      <span class="flex shrink-0 gap-1">
        <Button size="sm" disabled={props.busy} onClick={props.onReview}>
          {m.cloud_review()}
        </Button>
        <Show when={!props.declining}>
          <Button size="sm" variant="tertiary" disabled={props.busy} onClick={props.onStartDecline}>
            {m.common_decline()}
          </Button>
        </Show>
      </span>
    </div>
    <Show when={props.declining}>
      <form
        class="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          props.onDecline();
        }}
      >
        <Input
          size="sm"
          wrapperClass="min-w-0 flex-1"
          placeholder={m.common_why_author_will_read_this({
            author: props.suggestion.author,
          })}
          value={props.note}
          onInput={(event) => props.onNote(event.currentTarget.value)}
        />
        <Button size="sm" type="submit" disabled={props.busy}>
          {m.common_decline()}
        </Button>
        <Button size="sm" variant="tertiary" onClick={props.onCancel}>
          {m.common_not_now()}
        </Button>
      </form>
    </Show>
  </li>
);

type CardProps = {
  readonly project: Project;
  readonly signedIn: boolean;
  readonly asked?: number;
};

const createWaitingList = (props: CardProps) => {
  const { services } = useShell();
  const [writer, setWriter] = createSignal<boolean | undefined>(undefined, {
    name: "suggestionsWriter",
  });
  const [waiting, setWaiting] = createSignal<readonly Suggestion[]>([], {
    name: "suggestionsWaiting",
  });

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
  return { writer, waiting, load };
};

const createSuggestionActions = (
  props: CardProps,
  load: (project: Project, signedIn: boolean) => Promise<void>,
) => {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
  const [busy, setBusy] = createSignal(false, { name: "suggestionsBusy" });

  const act = (work: Promise<unknown>, done: string, project: Project, signedIn: boolean): void => {
    setBusy(true);
    work
      .then(() => toasts.success({ title: done }))
      .catch((cause: unknown) =>
        toasts.error({ title: m.cloud_that_did_not_work(), message: describe(cause) }),
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
        toasts.error({ title: m.cloud_could_not_open_the_suggestion(), message: describe(cause) }),
      )
      .finally(() => setBusy(false));
  };
  return { busy, act, review };
};

export function SuggestionsCard(props: CardProps) {
  const { services } = useShell();
  const { writer, waiting, load } = createWaitingList(props);
  const { busy, act, review } = createSuggestionActions(props, load);
  const [declining, setDeclining] = createSignal<number | undefined>(undefined, {
    name: "suggestionsDeclining",
  });
  const [note, setNote] = createSignal("", { name: "suggestionsDeclineNote" });

  return (
    <Show when={props.signedIn && writer() === true}>
      <QuietSection
        title={m.cloud_to_review()}
        count={waiting().length}
        note={m.cloud_from_people_working_in_their()}
        data={{ "data-cloud-card": "suggestions" }}
      >
        <Show
          when={waiting().length > 0}
          fallback={
            <p class="text-small text-on-surface-tertiary">{m.cloud_nothing_is_waiting()}</p>
          }
        >
          <ul class="space-y-1">
            <For each={waiting()}>
              {(suggestion) => (
                <SuggestionRow
                  suggestion={suggestion}
                  busy={busy()}
                  declining={declining() === suggestion.number}
                  note={note()}
                  onReview={() => review(suggestion)}
                  onStartDecline={() => {
                    setNote("");
                    setDeclining(suggestion.number);
                  }}
                  onNote={setNote}
                  onDecline={() => {
                    setDeclining(undefined);
                    act(
                      declineSuggestion(services, props.project, suggestion, note()),
                      m.common_declined(),
                      props.project,
                      props.signedIn,
                    );
                  }}
                  onCancel={() => setDeclining(undefined)}
                />
              )}
            </For>
          </ul>
        </Show>
      </QuietSection>
    </Show>
  );
}
