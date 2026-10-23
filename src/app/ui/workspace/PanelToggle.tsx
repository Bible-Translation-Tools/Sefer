import type { JSX } from "@solidjs/web";
import BookIcon from "lucide-solid/icons/book";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import { Show } from "solid-js";

import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { Button, IconButton } from "../primitives";
import { layout } from "./layoutTweak";
import { useScreen } from "./screen";
import { sidebarLabel } from "./sidebarSlot";

export function PanelToggle(props: { readonly class?: string }) {
  const shell = useShell();
  const showing = (): boolean => shell.sidebarShowing();
  return (
    <IconButton
      class={props.class}
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
    layout() !== "panels" &&
    shell.project() !== undefined &&
    screen.inProject() &&
    !screen.onEditor();
  return () => (wanted() ? <PanelToggle /> : undefined);
}

/**
 * The panels layout (a design tweak): the project panel's show/hide for every
 * screen, drawn at the top of the panel itself (`_app.tsx`). Panel hidden,
 * the panel folds to a rail that still holds this button, so nothing floats
 * over the page. Labelled for what it does now, and for what the panel holds.
 */
export function SidebarButton(props: { readonly showing: boolean }) {
  const shell = useShell();
  return (
    <Button
      variant="tertiary"
      data-testid={props.showing ? "panel-toggle" : "book-fab"}
      aria-expanded={props.showing ? "true" : "false"}
      onClick={() => shell.setSidebarOpen(!props.showing)}
    >
      <Show when={props.showing} fallback={<BookIcon aria-hidden="true" />}>
        <PanelLeftClose aria-hidden="true" />
      </Show>
      {(() => {
        // Named for what the panel holds now: books, unless a screen has
        // put something else there (key terms, results, changes…).
        const label = sidebarLabel();
        if (props.showing) return label?.hide ?? m.sidebar_hide_books();
        return label?.show ?? m.sidebar_show_books();
      })()}
    </Button>
  );
}
