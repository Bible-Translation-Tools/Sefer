/**
 * `/suggestions` — what people working in their own copy offer, for the
 * project's editors: each one to review in Review, or to decline with a note
 * its author reads. A tab beside Changes and History, because a suggestion is
 * one more thing about to change the project, and Review is where it changes.
 */

import Inbox from "lucide-solid/icons/inbox";
import { Show, onCleanup } from "solid-js";

import { collaboration } from "../../collaboration";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { EmptyState, PanelHeader } from "../primitives";
import { ChangesHistorySidebar } from "../workspace/ChangesHistorySidebar";
import { claimSidebar } from "../workspace/sidebarSlot";
import { SuggestionsCard } from "./SuggestionsCard";
import { YourSuggestions } from "./YourSuggestions";

export function SuggestionsScreen() {
  const shell = useShell();
  const facts = () => collaboration.facts(shell.project()?.root);
  // Somebody came to look: ask, if the check has not yet.
  const opened = shell.project();
  if (opened !== undefined && collaboration.facts(opened.root) === undefined)
    void collaboration.refresh(shell.services, opened);

  onCleanup(
    claimSidebar(() => (
      <ChangesHistorySidebar active="suggestions">
        <p class="px-6 pt-3 text-small text-on-surface-tertiary">
          {t("Suggestions are offered from people's own copies.")}
        </p>
      </ChangesHistorySidebar>
    )),
  );

  // Neither list applies: a writer sees what waits, a person in their own copy
  // sees their own, and someone who is both sees both.
  const nothing = (): boolean => facts()?.mode !== "copy" && facts()?.canWrite !== true;

  return (
    <main class="flex h-full min-w-0 flex-col gap-4 overflow-y-auto p-6" data-screen="suggestions">
      <PanelHeader
        title={t("Suggestions")}
        subtitle={t("The shared project only changes when an editor accepts.")}
      />
      <Show when={facts()?.mode === "copy" ? shell.project() : undefined}>
        {(project) => <YourSuggestions project={project()} />}
      </Show>
      <Show when={facts()?.canWrite === true ? shell.project() : undefined}>
        {(project) => <SuggestionsCard project={project()} signedIn />}
      </Show>
      <Show when={nothing()}>
        <EmptyState
          icon={<Inbox aria-hidden="true" />}
          title={t("No suggestions here")}
          description={t(
            "Suggestions are offered from your own copy, and reviewed by the shared project's editors. Choose how you work in Settings.",
          )}
        />
      </Show>
    </main>
  );
}
