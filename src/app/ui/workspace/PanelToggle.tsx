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
import BookIcon from "lucide-solid/icons/book";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import { Show } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { IconButton } from "../primitives";
import { layout } from "./layoutTweak";
import { useScreen } from "./screen";

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
    layout() !== "panels" &&
    shell.project() !== undefined &&
    screen.inProject() &&
    !screen.onEditor();
  return () => (wanted() ? <PanelToggle /> : undefined);
}

/**
 * The panels layout (a design tweak): the project panel's show/hide for every
 * screen, drawn by the workspace beside the panel rather than in any page.
 *
 * Panel showing: the toggle just outside the panel, 64px square like the
 * project card's height and 16px from the top, so the two line up; the page
 * beside it keeps its own padding clear of it. Panel hidden: a floating 64px book button, 24px from the window's
 * edge and level with the card's row, that opens it again.
 */
export function PanelGutter(props: { readonly showing: boolean }) {
  const shell = useShell();
  return (
    <Show when={layout() === "panels" && shell.project() !== undefined}>
      <Show
        when={props.showing}
        fallback={
          <button
            type="button"
            data-testid="book-fab"
            aria-label={t("Show the books")}
            title={t("Show the books")}
            // 72px app bar + 16px: level with the project card's 64px row.
            class="fixed start-6 top-[88px] z-30 flex size-16 cursor-pointer items-center justify-center rounded-3xl bg-surface-primary text-on-surface-primary shadow-medium transition-colors hover:bg-surface-secondary"
            onClick={() => shell.setSidebarOpen(true)}
          >
            <BookIcon aria-hidden="true" class="size-6" />
          </button>
        }
      >
        {/* The same place as the book button: the control never moves,
            whether the panel is open or not. The project card makes room. */}
        <PanelToggle class="fixed start-6 top-[88px] z-30 size-16 rounded-3xl!" />
      </Show>
    </Show>
  );
}
