import BookIcon from "lucide-solid/icons/book";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import { Show } from "solid-js";

import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { Button } from "../primitives";
import { sidebarLabel } from "./sidebarSlot";

/**
 * The project panel's show/hide for every screen, drawn at the top of the panel itself (`_app.tsx`). Panel hidden,
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
