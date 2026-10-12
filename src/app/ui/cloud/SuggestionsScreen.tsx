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
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { Show, createSignal, onCleanup, untrack } from "solid-js";

import { collaboration } from "../../collaboration";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { ago } from "../panels/format";
import { EmptyState, IconButton, PanelHeader, cx } from "../primitives";
import { ChangesHistorySidebar } from "../workspace/ChangesHistorySidebar";
import { claimSidebar } from "../workspace/sidebarSlot";
import { SuggestionsCard } from "./SuggestionsCard";
import { YourSuggestions } from "./YourSuggestions";

export function SuggestionsScreen() {
  const shell = useShell();
  const facts = () => collaboration.facts(shell.project()?.root);
  /**
   * Bumped by the refresh button: both lists read their suggestions again
   * when it moves, and the tab's count with them.
   */
  const [asked, setAsked] = createSignal(0, { name: "suggestionsAsked" });
  const [checking, setChecking] = createSignal(false, { name: "suggestionsChecking" });
  const check = (): void => {
    const opened = shell.project();
    if (opened === undefined || checking()) return;
    setChecking(true);
    setAsked((n) => n + 1);
    void collaboration.refresh(shell.services, opened).finally(() => setChecking(false));
  };
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
    <main class="flex h-full min-w-0 flex-col gap-6 overflow-y-auto p-6" data-screen="suggestions">
      <PanelHeader
        title={t("Suggestions")}
        subtitle={t("The shared project only changes when an editor accepts.")}
        actions={
          // When the lists were asked, and asking again — as Review's status
          // line does for the shared project.
          <span class="inline-flex items-center gap-0.5 text-smallest text-on-surface-tertiary">
            <Show when={facts()?.checkedAt}>
              {(at) => <span>{t("checked {when}", { when: ago(at()) })}</span>}
            </Show>
            <IconButton
              size="sm"
              label={t("Check for suggestions")}
              disabled={checking()}
              icon={<RefreshCw class={cx(checking() && "animate-spin")} />}
              onClick={check}
            />
          </span>
        }
      />
      {/* What waits on you first: an editor's queue is the reason most people
          open this tab. */}
      <Show when={facts()?.canWrite === true ? shell.project() : undefined}>
        {(project) => <SuggestionsCard project={project()} signedIn asked={asked()} />}
      </Show>
      <Show when={facts()?.mode === "copy" ? shell.project() : undefined}>
        {(project) => <YourSuggestions project={project()} asked={asked()} />}
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
