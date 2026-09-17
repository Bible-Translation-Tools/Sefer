/**
 * The way back to the book, on every screen that is not the book.
 *
 * A full-page route — findings, history, review, compare, find, terms,
 * inventory, cloud, settings, the projects list — replaces the editor
 * entirely, and the only door back was the rail's panel tile, which reads as
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

import { useNavigate, useRouterState } from "@tanstack/solid-router";
import X from "lucide-solid/icons/x";
import { Show, onCleanup } from "solid-js";

import { registerCommand } from "../../commands";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { IconButton } from "../primitives";
import { bookName } from "./books";
import { metadataOf } from "./project";

export function BackToEditor() {
  const shell = useShell();
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });

  /**
   * Is there a book behind this screen to go back TO?
   *
   * A project route already IS the work, so it needs no door; every other
   * route has one as soon as a project is open. `/project/` as a prefix and
   * not an equality, because the census and the editor are both the work.
   */
  const away = (): boolean => shell.project() !== undefined && !path().startsWith("/project/");

  const label = (): string => {
    const project = shell.project();
    if (project === undefined) return t("Back to the editor");
    const held = shell.lastLocation(project.root);
    if (held === undefined) return t("Back to the project");
    return t("Back to {book}", { book: bookName(held.bookId, metadataOf(project)) });
  };

  const back = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    // The remembered location, which is where the reader was before the panel
    // took the screen — the same answer the rail's tile gives, so the two
    // doors cannot disagree.
    // SAFETY: the path is built at runtime from a project root and a book id,
    // which no route literal union can spell; an unresolvable one goes through
    // the router's own not-found boundary.
    void navigate(shell.landingTarget(project.root));
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
          icon={<X size={16} />}
          onClick={back}
        />
      </div>
    </Show>
  );
}
