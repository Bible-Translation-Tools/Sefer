/**
 * The sidebar of the two screens that read the project's versions: Changes
 * (Review — what is not recorded yet) and History (what was), as two tabs over
 * one panel, the way Zed's git panel puts them.
 *
 * The tabs are links, and the route is the tab: Review draws Changes, History
 * draws History, so Back and Forward move between them and neither screen
 * keeps a tab of its own. Each screen claims the sidebar (`sidebarSlot`) and
 * puts its own list under the tabs.
 */

import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";

const TAB = [
  "flex-1 border-b-2 px-3 py-2 text-center text-small no-underline transition-colors",
  "aria-[current=page]:border-brand aria-[current=page]:font-medium aria-[current=page]:text-on-surface-primary",
  "not-aria-[current=page]:border-transparent not-aria-[current=page]:text-on-surface-tertiary",
  "not-aria-[current=page]:hover:text-on-surface-secondary",
].join(" ");

export function ChangesHistorySidebar(props: {
  readonly active: "changes" | "history";
  /** Books with changes, when the screen knows; the Changes tab says how many. */
  readonly changes?: number;
  readonly children: JSX.Element;
}) {
  const shell = useShell();
  return (
    <div
      class="flex h-full flex-col border-e border-sidebar-border bg-sidebar-surface"
      data-testid="sidebar"
      data-sidebar={props.active}
    >
      <nav aria-label={t("Changes and history")} class="flex border-b border-sidebar-border">
        <Link
          to="/project/$slug/review"
          params={{ slug: shell.slug() }}
          class={TAB}
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
          class={TAB}
          aria-current={props.active === "history" ? "page" : undefined}
          data-sidebar-tab="history"
        >
          {t("History")}
        </Link>
      </nav>
      <div class="flex min-h-0 flex-1 flex-col">{props.children}</div>
    </div>
  );
}
