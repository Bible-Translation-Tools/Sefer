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
import { IconButton, cx } from "../primitives";
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
  // One control in one place — 24px from the window's edge, 16px below the
  // app bar — labelled for what it does now: hide the books, or show them.
  return (
    <Show when={layout() === "panels" && shell.project() !== undefined}>
      <button
        type="button"
        data-testid={props.showing ? "panel-toggle" : "book-fab"}
        aria-expanded={props.showing ? "true" : "false"}
        class={cx(
          "fixed start-6 top-[88px] z-30 flex h-12 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-small font-medium text-on-surface-primary transition-colors hover:bg-surface-secondary",
          !props.showing && "bg-surface-primary shadow-medium",
        )}
        onClick={() => shell.setSidebarOpen(!props.showing)}
      >
        <Show
          when={props.showing}
          fallback={<BookIcon aria-hidden="true" class="size-5 shrink-0" />}
        >
          <PanelLeftClose aria-hidden="true" class="size-5 shrink-0" />
        </Show>
        {props.showing ? t("Hide books") : t("Show books")}
      </button>
    </Show>
  );
}
