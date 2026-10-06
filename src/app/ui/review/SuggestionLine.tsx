/**
 * Review against a suggestion says whose it is: who offered it, its title,
 * when it last moved, and the messages of the versions it would bring — the
 * words its author wrote — so the reviewer is not deciding on text alone.
 */

import { For, Show, createEffect, createSignal } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { suggestionDetails, type SuggestionDetails } from "../../suggestions";
import { ago } from "../panels/format";

/** How many of the suggestion's version messages are listed before "and N more". */
const SHOWN = 3;

export function SuggestionLine(props: { readonly number: number }) {
  const shell = useShell();
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
          <p class="text-small">
            <span class="font-semibold">{held().suggestion.author}</span>
            <span class="text-on-surface-secondary">
              {" "}
              {t("suggested")} “{held().suggestion.title}” ·{" "}
              {ago(Date.parse(held().suggestion.updatedAt))}
            </span>
          </p>
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
        </div>
      )}
    </Show>
  );
}
