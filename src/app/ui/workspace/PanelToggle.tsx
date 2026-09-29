/**
 * The project panel's show/hide: one button that stays where it is and flips.
 *
 * It sits left of the book's title in the editor toolbar, nearest the panel,
 * and on a project
 * screen with no such title (terms, findings, history…) in the same top-left
 * spot, in a narrow column of its own (`PanelToggleColumn`) so it covers
 * nothing. Because the button is outside the panel it survives the panel
 * being hidden, and is the way back. `Mod-b` does the same, and dragging the
 * panel's edge closed hides it too (`onCollapse` in _app.tsx).
 */

import { useRouterState } from "@tanstack/solid-router";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import { Show } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { IconButton } from "../primitives";

export function PanelToggle() {
  const shell = useShell();
  const showing = (): boolean => shell.sidebarShowing();
  return (
    <IconButton
      size="sm"
      data-testid="panel-toggle"
      aria-expanded={showing() ? "true" : "false"}
      label={showing() ? t("Hide the project panel") : t("Show the project panel")}
      icon={showing() ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      onClick={() => shell.setSidebarOpen(!showing())}
    />
  );
}

/**
 * The toggle for a project screen that has no editor toolbar to carry it.
 * Rendered ONCE by the workspace, beside `BackToEditor`, so a screen added
 * later gets it without knowing it exists; the book route's toolbar has its
 * own, next to the title.
 */
export function PanelToggleColumn() {
  const shell = useShell();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const wanted = (): boolean =>
    shell.project() !== undefined && path().startsWith("/project/") && !path().includes("/book/");
  return (
    <Show when={wanted()}>
      <div class="shrink-0 px-2 pt-6">
        <PanelToggle />
      </div>
    </Show>
  );
}
