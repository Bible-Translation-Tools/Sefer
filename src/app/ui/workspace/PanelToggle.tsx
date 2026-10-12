/**
 * The project panel's show/hide: one button that stays where it is and flips.
 *
 * It sits left of the book's title in the editor toolbar, nearest the panel,
 * and on a project
 * screen with no such title (terms, findings, history…) at the start of that
 * screen's page header, inline with its title (`usePanelToggleLeading`). Because the button is outside the panel it survives the panel
 * being hidden, and is the way back. `Mod-b` does the same, and dragging the
 * panel's edge closed hides it too (`onCollapse` in _app.tsx).
 */

import type { JSX } from "@solidjs/web";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { IconButton } from "../primitives";
import { useScreen } from "./screen";

export function PanelToggle() {
  const shell = useShell();
  const showing = (): boolean => shell.sidebarShowing();
  return (
    <IconButton
      variant="quiet"
      data-testid="panel-toggle"
      aria-expanded={showing() ? "true" : "false"}
      label={showing() ? t("Hide the project panel") : t("Show the project panel")}
      icon={showing() ? <PanelLeftClose /> : <PanelLeftOpen />}
      onClick={() => shell.setSidebarOpen(!showing())}
    />
  );
}

/**
 * The toggle for a project screen that has no editor toolbar to carry it:
 * handed to that screen's page header (`PageLeading`), so it sits inline
 * with the title. Provided ONCE by the workspace, so a screen added later
 * gets it without knowing it exists; the book route's toolbar has its own.
 */
export function usePanelToggleLeading(): () => JSX.Element | undefined {
  const shell = useShell();
  const screen = useScreen();
  const wanted = (): boolean =>
    shell.project() !== undefined && screen.inProject() && !screen.onEditor();
  return () => (wanted() ? <PanelToggle /> : undefined);
}
