/**
 * The way back to the book, on every screen that is not the book.
 *
 * A full-page route — findings, history, review, compare, find, terms,
 * inventory, cloud, settings, the projects list — replaces the editor
 * entirely, and the only door back was the old rail's panel tile, which reads as
 * a panel toggle and not as "close this". So the door is spelled out: one
 * button, pinned to the top-right of the routed content, that says which book
 * it returns to.
 *
 * It is rendered ONCE, by the root chrome above the `<Outlet/>`, and not by
 * each page. That is the whole point of putting it here — a screen added
 * later gets the door without knowing it exists, and no page can forget it or
 * spell it differently.
 *
 * The same component registers `editor.back`, so the palette lists it and
 * Escape performs it. Registered here rather than in the shell's core set
 * because the question "is this a full-page screen" is the ROUTE's, and the
 * `ShellBridge` deliberately does not carry a pathname.
 */

import { useNavigate } from "@tanstack/solid-router";
import X from "lucide-solid/icons/x";
import { Show, onCleanup } from "solid-js";

import { registerCommand } from "../../commands";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { IconButton } from "../primitives";
import { bookName } from "./books";
import { metadataOf } from "./project";
import { useScreen } from "./screen";

export function BackToEditor() {
  const shell = useShell();
  const navigate = useNavigate();
  const screen = useScreen();

  /**
   * Is there work behind this screen to go back TO? The work is the editor
   * (`useScreen`); every other screen is a panel over the top of it and needs
   * a door out, as soon as a project is open — except Key terms, which is a
   * mode like the editor's, left through the mode switcher.
   */
  const away = (): boolean => shell.project() !== undefined && !screen.onMode();

  const label = (): string => {
    const project = shell.project();
    if (project === undefined) return t("Back to the editor");
    const held = shell.lastLocation(project.root);
    if (held === undefined) return t("Back to the project");
    return t("Back to {book}", { book: bookName(held.bookId, metadataOf(project)) });
  };

  const back = (): void => {
    if (shell.project() === undefined) return;
    // The PARENT route, and nothing cleverer. `/project/$slug` already knows
    // where the work is — it forwards to the remembered book, and falls back
    // to the first book when that one is gone — so asking it is one door
    // instead of two answers that can disagree.
    void navigate({ to: "/project/$slug", params: { slug: shell.slug() } });
  };

  onCleanup(
    registerCommand({
      id: "editor.back",
      title: t("Back to the editor"),
      // A bare key, so `installCommandKeys` will not claim it while the reader
      // is typing into a box, a text area or the editor itself.
      keys: "Escape",
      when: away,
      run: back,
    }),
  );

  return (
    <Show when={away()}>
      <div class="absolute end-4 top-4 z-30">
        <IconButton
          data-testid="back-to-editor"
          variant="outlined"
          label={label()}
          tooltipSide="left"
          icon={<X />}
          onClick={back}
        />
      </div>
    </Show>
  );
}
