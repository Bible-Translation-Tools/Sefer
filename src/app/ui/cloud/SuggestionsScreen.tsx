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

const CheckAction = (props: {
  readonly checkedAt: number | undefined;
  readonly checking: boolean;
  readonly onCheck: () => void;
}) => (
  <span class="inline-flex items-center gap-0.5 text-smallest text-on-surface-tertiary">
    <Show when={props.checkedAt}>
      {(at) => <span>{t("checked {when}", { when: ago(at()) })}</span>}
    </Show>
    <IconButton
      size="sm"
      label={t("Check for suggestions")}
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
            {t("Suggestions are offered from people's own copies.")}
          </p>
        </ChangesHistorySidebar>
      ),
      { show: t("Show suggestions"), hide: t("Hide suggestions") },
    ),
  );

  const nothing = (): boolean => facts()?.mode !== "copy" && facts()?.canWrite !== true;

  return (
    <main class="flex h-full min-w-0 flex-col gap-6 overflow-y-auto p-6" data-screen="suggestions">
      <PanelHeader
        title={t("Suggestions")}
        subtitle={t("The shared project only changes when an editor accepts.")}
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
          title={t("No suggestions here")}
          description={t(
            "Suggestions are offered from your own copy, and reviewed by the shared project's editors. Choose how you work in Settings.",
          )}
        />
      </Show>
    </main>
  );
}
