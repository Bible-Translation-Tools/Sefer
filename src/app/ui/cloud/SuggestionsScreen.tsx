import Inbox from "lucide-solid/icons/inbox";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { Show, createSignal, onCleanup, untrack } from "solid-js";

import { collaboration } from "../../collaboration";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { ago } from "../panels/format";
import { EmptyState, IconButton, PanelHeader, cx } from "../primitives";
import { ChangesHistorySidebar } from "../workspace/ChangesHistorySidebar";
import { claimSidebar } from "../workspace/sidebarSlot";
import { SuggestionsCard } from "./SuggestionsCard";
import { YourSuggestions } from "./YourSuggestions";

const CheckAction = (props: {
  readonly checkedAt: number | undefined;
  readonly checking: boolean;
  readonly onCheck: () => void;
}) => (
  <span class="inline-flex items-center gap-0.5 text-smallest text-on-surface-tertiary">
    <Show when={props.checkedAt}>
      {(at) => <span>{m.cloud_checked_when({ when: ago(at()) })}</span>}
    </Show>
    <IconButton
      size="sm"
      label={m.cloud_check_for_suggestions()}
      disabled={props.checking}
      icon={<RefreshCw class={cx(props.checking && "animate-spin")} />}
      onClick={props.onCheck}
    />
  </span>
);

export function SuggestionsScreen() {
  const shell = useShell();
  const facts = () => collaboration.facts(shell.project()?.root);
  const [asked, setAsked] = createSignal(0, { name: "suggestionsAsked" });
  const [checking, setChecking] = createSignal(false, { name: "suggestionsChecking" });
  const check = (): void => {
    const opened = shell.project();
    if (opened === undefined || checking()) return;
    setChecking(true);
    setAsked((count) => count + 1);
    void collaboration.refresh(shell.services, opened).finally(() => setChecking(false));
  };
  // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
  untrack(() => {
    const opened = shell.project();
    if (opened !== undefined) void collaboration.refresh(shell.services, opened);
  });

  onCleanup(
    claimSidebar(
      () => (
        <ChangesHistorySidebar active="suggestions">
          <p class="px-6 pt-3 text-small text-on-surface-tertiary">
            {m.cloud_suggestions_are_offered_from_peoples()}
          </p>
        </ChangesHistorySidebar>
      ),
      { show: m.sidebar_show_suggestions(), hide: m.sidebar_hide_suggestions() },
    ),
  );

  const nothing = (): boolean => facts()?.mode !== "copy" && facts()?.canWrite !== true;

  return (
    <main class="flex h-full min-w-0 flex-col gap-6 overflow-y-auto p-6" data-screen="suggestions">
      <PanelHeader
        title={m.common_suggestions()}
        subtitle={m.cloud_the_shared_project_only_changes_when()}
        actions={
          <CheckAction checkedAt={facts()?.checkedAt} checking={checking()} onCheck={check} />
        }
      />

      <Show when={facts()?.canWrite === true ? shell.project() : undefined}>
        {(project) => <SuggestionsCard project={project()} signedIn asked={asked()} />}
      </Show>
      <Show when={facts()?.mode === "copy" ? shell.project() : undefined}>
        {(project) => <YourSuggestions project={project()} asked={asked()} />}
      </Show>
      <Show when={nothing()}>
        <EmptyState
          icon={<Inbox aria-hidden="true" />}
          title={m.cloud_no_suggestions_here()}
          description={m.cloud_suggestions_are_offered_from_your()}
        />
      </Show>
    </main>
  );
}
