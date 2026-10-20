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

export function usePanelToggleLeading(): () => JSX.Element | undefined {
  const shell = useShell();
  const screen = useScreen();
  const wanted = (): boolean =>
    shell.project() !== undefined && screen.inProject() && !screen.onEditor();
  return () => (wanted() ? <PanelToggle /> : undefined);
}
