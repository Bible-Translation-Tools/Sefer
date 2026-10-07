/**
 * `/suggestions` — suggested changes, from both ends, in one tab beside
 * Changes and History (a suggestion is one more thing about to change the
 * project, and Review is where it changes):
 *
 * - **Yours**, for someone working in their own copy (`YourSuggestions`):
 *   what they offered, how each stands, offering more, withdrawing one;
 * - **To review**, for the shared project's editors (`SuggestionsCard`): each
 *   one to review in Review, or to decline with a note its author reads.
 *
 * One tab rather than two: four tabs do not fit the sidebar, and both lists
 * answer one question — what is suggested for this project.
 */

import Inbox from "lucide-solid/icons/inbox";
import { Show, onCleanup, untrack } from "solid-js";

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
  // Somebody came to look: ask again, so the tab's count and the lists below
  // say the same thing. A one-time read at mount, untracked on purpose.
  untrack(() => {
    const opened = shell.project();
    if (opened !== undefined) void collaboration.refresh(shell.services, opened);
  });

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
