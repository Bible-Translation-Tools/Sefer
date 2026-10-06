/**
 * The sidebar of the screens that read the project's versions: Changes
 * (Review — what is not recorded yet), History (what was), and — for someone
 * who can write to the shared project — Suggestions (what others offer), as
 * tabs over one panel, the way Zed's git panel puts them.
 *
 * The tabs are links, and the route is the tab: Review draws Changes, History
 * draws History, so Back and Forward move between them and neither screen
 * keeps a tab of its own. Each screen claims the sidebar (`sidebarSlot`) and
 * puts its own list under the tabs.
 */

import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { Show } from "solid-js";

import { collaboration } from "../../collaboration";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { cx } from "../primitives";
import type { VersionsTab } from "./screen";

const TAB = [
  "border-b-2 px-3 py-2 text-center text-small no-underline transition-colors",
  "aria-[current=page]:border-brand aria-[current=page]:font-medium aria-[current=page]:text-on-surface-primary",
  "not-aria-[current=page]:border-transparent not-aria-[current=page]:text-on-surface-tertiary",
  "not-aria-[current=page]:hover:text-on-surface-secondary",
].join(" ");

/**
 * The tabs themselves: in the sidebar they share its width; above the page,
 * where the workspace draws them while the sidebar is hidden, they sit at
 * their own width — the screens stay one click apart either way.
 */
export function VersionTabs(props: {
  readonly active: VersionsTab;
  readonly changes?: number;
  readonly inline?: boolean;
}) {
  const shell = useShell();
  const facts = () => collaboration.facts(shell.project()?.root);
  const tab = (): string => cx(TAB, props.inline !== true && "flex-1");
  return (
    <nav
      aria-label={t("Changes and history")}
      class={cx("flex", props.inline !== true && "border-b border-sidebar-border")}
      data-version-tabs={props.inline === true ? "page" : "sidebar"}
    >
      <Link
        to="/project/$slug/review"
        params={{ slug: shell.slug() }}
        class={tab()}
        aria-current={props.active === "changes" ? "page" : undefined}
        data-sidebar-tab="changes"
      >
        {props.changes === undefined || props.changes === 0
          ? t("Changes")
          : t("Changes ({count})", { count: props.changes })}
      </Link>
      <Link
        to="/project/$slug/history"
        params={{ slug: shell.slug() }}
        class={tab()}
        aria-current={props.active === "history" ? "page" : undefined}
        data-sidebar-tab="history"
      >
        {t("History")}
      </Link>
      {/* An editor's tab: the suggestions only someone who can write brings in. */}
      <Show when={facts()?.canWrite === true || props.active === "suggestions"}>
        <Link
          to="/project/$slug/suggestions"
          params={{ slug: shell.slug() }}
          class={tab()}
          aria-current={props.active === "suggestions" ? "page" : undefined}
          data-sidebar-tab="suggestions"
        >
          {(facts()?.waiting ?? 0) === 0
            ? t("Suggestions")
            : t("Suggestions ({count})", { count: facts()?.waiting ?? 0 })}
        </Link>
      </Show>
    </nav>
  );
}

export function ChangesHistorySidebar(props: {
  readonly active: VersionsTab;
  /** Books with changes, when the screen knows; the Changes tab says how many. */
  readonly changes?: number;
  readonly children: JSX.Element;
}) {
  return (
    <div
      class="flex h-full flex-col border-e border-sidebar-border bg-sidebar-surface"
      data-testid="sidebar"
      data-sidebar={props.active}
    >
      <VersionTabs
        active={props.active}
        {...(props.changes === undefined ? {} : { changes: props.changes })}
      />
      <div class="flex min-h-0 flex-1 flex-col">{props.children}</div>
    </div>
  );
}
