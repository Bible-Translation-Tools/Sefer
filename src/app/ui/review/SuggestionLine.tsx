import { useNavigate } from "@tanstack/solid-router";
import { Show, createEffect, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { useShell, type Navigate, type Shell } from "../../ProjectContext";
import { declineSuggestion, suggestionDetails, type SuggestionDetails } from "../../suggestions";
import { ago } from "../panels/format";
import { Button, Input, toasts } from "../primitives";

function declineHeld(
  shell: Shell,
  navigate: Navigate,
  state: {
    readonly note: () => string;
    readonly busy: () => boolean;
    readonly setBusy: (busy: boolean) => void;
  },
  held: SuggestionDetails,
  event: SubmitEvent,
): void {
  event.preventDefault();
  const project = shell.project();
  if (project === undefined || state.busy()) return;
  const staticNote = state.note();
  state.setBusy(true);
  declineSuggestion(shell.services, project, held.suggestion, staticNote)
    .then(() => {
      toasts.success({
        title: m.review_declined(),
        message:
          staticNote.trim() === ""
            ? m.review_the_suggestion_is_closed_author({
                author: held.suggestion.author,
              })
            : m.review_author_can_read_your_note({ author: held.suggestion.author }),
      });
      void collaboration.refresh(shell.services, project);
      void navigate({ to: "/project/$slug/suggestions", params: { slug: shell.slug() } });
    })
    .catch((cause: unknown) =>
      toasts.error({ title: m.review_could_not_decline_it(), message: describe(cause) }),
    )
    .finally(() => state.setBusy(false));
}

function DeclineForm(props: {
  readonly held: SuggestionDetails;
  readonly note: () => string;
  readonly setNote: (note: string) => void;
  readonly busy: () => boolean;
  readonly onSubmit: (event: SubmitEvent) => void;
  readonly onCancel: () => void;
}) {
  return (
    <form
      class="flex flex-wrap items-center gap-2 pt-1"
      onSubmit={(event) => props.onSubmit(event)}
    >
      <Input
        size="sm"
        wrapperClass="min-w-0 flex-1"
        placeholder={m.review_why_author_will_read_this({
          author: props.held.suggestion.author,
        })}
        value={props.note()}
        onInput={(event) => props.setNote(event.currentTarget.value)}
      />
      <Button size="sm" type="submit" variant="secondary" loading={props.busy()}>
        {m.common_decline()}
      </Button>
      <Button size="sm" variant="tertiary" onClick={props.onCancel}>
        {m.common_not_now()}
      </Button>
    </form>
  );
}

export function SuggestionLine(props: { readonly number: number }) {
  const shell = useShell();
  const navigate = useNavigate();
  const [declining, setDeclining] = createSignal(false, { name: "reviewDeclining" });
  const [note, setNote] = createSignal("", { name: "reviewDeclineNote" });
  const [busy, setBusy] = createSignal(false, { name: "reviewDeclineBusy" });
  const decline = (held: SuggestionDetails, event: SubmitEvent): void =>
    declineHeld(shell, navigate, { note, busy, setBusy }, held, event);
  const [details, setDetails] = createSignal<SuggestionDetails | undefined>(undefined, {
    name: "reviewSuggestion",
  });
  createEffect(
    () => ({ project: shell.project(), number: props.number }),
    ({ project, number }) => {
      if (project === undefined) return;
      void suggestionDetails(shell.services, project, number).then(setDetails);
    },
  );
  return (
    <Show when={details()}>
      {(held) => (
        <div class="space-y-1" data-review-suggestion={props.number}>
          <div class="flex items-center gap-3">
            <p class="min-w-0 flex-1 text-small">
              <span class="font-semibold">{held().suggestion.author}</span>
              <span class="text-on-surface-secondary">
                {" "}
                {m.review_suggested()} “{held().suggestion.title}” ·{" "}
                {ago(Date.parse(held().suggestion.updatedAt))}
              </span>
            </p>
            <Show when={!declining() && held().suggestion.state === "open"}>
              <Button size="sm" variant="tertiary" onClick={() => setDeclining(true)}>
                {m.review_decline()}
              </Button>
            </Show>
          </div>
          <Show when={declining()}>
            <DeclineForm
              held={held()}
              note={note}
              setNote={setNote}
              busy={busy}
              onSubmit={(event) => decline(held(), event)}
              onCancel={() => setDeclining(false)}
            />
          </Show>
        </div>
      )}
    </Show>
  );
}
