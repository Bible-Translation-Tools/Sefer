/**
 * Review against a suggestion says whose it is: who offered it, its title,
 * when it last moved, and the messages of the versions it would bring — the
 * words its author wrote — so the reviewer is not deciding on text alone.
 *
 * And the one answer Review's Save does not give: Decline, with a note its
 * author reads. (Save brings it in, and closes it or leaves it open; when the
 * reviewer kept none of it, Save's dialog offers only this Decline.)
 */

import { useNavigate } from "@tanstack/solid-router";
import { For, Show, createEffect, createSignal } from "solid-js";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { declineSuggestion, suggestionDetails, type SuggestionDetails } from "../../suggestions";
import { ago } from "../panels/format";
import { Button, Input, toasts } from "../primitives";

/** How many of the suggestion's version messages are listed before "and N more". */
const SHOWN = 3;

export function SuggestionLine(props: { readonly number: number }) {
  const shell = useShell();
  const navigate = useNavigate();
  const [declining, setDeclining] = createSignal(false, { name: "reviewDeclining" });
  const [note, setNote] = createSignal("", { name: "reviewDeclineNote" });
  const [busy, setBusy] = createSignal(false, { name: "reviewDeclineBusy" });
  const decline = (held: SuggestionDetails, event: SubmitEvent): void => {
    event.preventDefault();
    const project = shell.project();
    if (project === undefined || busy()) return;
    // Read at the moment of the press.
    const staticNote = note();
    setBusy(true);
    declineSuggestion(shell.services, project, held.suggestion, staticNote)
      .then(() => {
        toasts.success({
          title: t("Declined"),
          message:
            staticNote.trim() === ""
              ? t("The suggestion is closed; {author} sees it was not brought in.", {
                  author: held.suggestion.author,
                })
              : t("{author} can read your note.", { author: held.suggestion.author }),
        });
        void collaboration.refresh(shell.services, project);
        void navigate({ to: "/project/$slug/suggestions", params: { slug: shell.slug() } });
      })
      .catch((cause: unknown) =>
        toasts.error({ title: t("Could not decline it"), message: describe(cause) }),
      )
      .finally(() => setBusy(false));
  };
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
        <div
          class="space-y-1 rounded-md border border-surface-border bg-surface-secondary px-3 py-2"
          data-review-suggestion={props.number}
        >
          <div class="flex items-start gap-3">
            <p class="min-w-0 flex-1 text-small">
              <span class="font-semibold">{held().suggestion.author}</span>
              <span class="text-on-surface-secondary">
                {" "}
                {t("suggested")} “{held().suggestion.title}” ·{" "}
                {ago(Date.parse(held().suggestion.updatedAt))}
              </span>
            </p>
            <Show when={!declining() && held().suggestion.state === "open"}>
              <Button size="sm" variant="tertiary" onClick={() => setDeclining(true)}>
                {t("Decline…")}
              </Button>
            </Show>
          </div>
          <Show when={held().versions.length > 0}>
            <ul class="space-y-0.5 ps-4 text-smallest text-on-surface-secondary">
              <For each={held().versions.slice(0, SHOWN)}>
                {(version) => <li class="list-disc">{version.message.split("\n")[0]}</li>}
              </For>
              <Show when={held().versions.length > SHOWN}>
                <li class="list-none text-on-surface-tertiary">
                  {t("and {count} more", { count: held().versions.length - SHOWN })}
                </li>
              </Show>
            </ul>
          </Show>
          <Show when={declining()}>
            <form
              class="flex flex-wrap items-center gap-2 pt-1"
              onSubmit={(event) => decline(held(), event)}
            >
              <Input
                size="sm"
                wrapperClass="min-w-0 flex-1"
                placeholder={t("Why? {author} will read this.", {
                  author: held().suggestion.author,
                })}
                value={note()}
                onInput={(event) => setNote(event.currentTarget.value)}
              />
              <Button size="sm" type="submit" variant="secondary" loading={busy()}>
                {t("Decline")}
              </Button>
              <Button size="sm" variant="tertiary" onClick={() => setDeclining(false)}>
                {t("Not now")}
              </Button>
            </form>
          </Show>
        </div>
      )}
    </Show>
  );
}
