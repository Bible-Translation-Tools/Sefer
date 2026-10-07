/**
 * The way back to the book, on a screen that is not the book.
 *
 * Two pieces. `useBackToEditor` is the behaviour: off a project's routes it
 * answers `undefined`, and inside them it answers a label ("Back to Luke") and
 * a `go` that navigates to `/project/$slug`. `BackToEditor` is the default UI
 * for it — a plain × button with no position of its own, so a screen puts it
 * wherever its header wants it.
 *
 * Every page-level `PanelHeader` ends with one by default: the layout hands
 * `PanelHeader` the button through `PageDoor` (`routes/_app.tsx`), so a screen
 * added later still gets a door without knowing it exists. A screen that wants
 * it elsewhere passes `door={false}` and places `<BackToEditor />` itself; a
 * header that is not a `PanelHeader` (Review's) places it directly.
 *
 * The hook registers `editor.back`, so the palette lists it on any screen that
 * draws the door. It has no key: Escape belongs to whatever dialog is open on
 * the screen.
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

interface BackToEditorTarget {
  readonly label: string;
  readonly go: () => void;
}

/**
 * Is there a book behind this screen to go back to? Asked of the route —
 * inside `/_app/project/$slug` or not — never of a pathname.
 */
// fallow-ignore-next-line unused-export -- the behaviour half, for a screen that draws its own door; BackToEditor is the only consumer today.
export function useBackToEditor(): () => BackToEditorTarget | undefined {
  const shell = useShell();
  const navigate = useNavigate();
  const screen = useScreen();

  const label = (): string => {
    const project = shell.project();
    if (project === undefined) return t("Back to the editor");
    const held = shell.lastLocation(project.root);
    if (held === undefined) return t("Back to the project");
    return t("Back to {book}", { book: bookName(held.bookId, metadataOf(project)) });
  };

  // The PARENT route, and nothing cleverer. `/project/$slug` already knows
  // where the work is — it forwards to the remembered book, and falls back to
  // the first book when that one is gone — so asking it is one door instead of
  // two answers that can disagree.
  const go = (): void => {
    void navigate({ to: "/project/$slug", params: { slug: shell.slug() } });
  };

  const shown = (): boolean => screen.inProject() && shell.project() !== undefined;

  onCleanup(
    registerCommand({
      id: "editor.back",
      title: t("Back to the editor"),
      when: shown,
      run: go,
    }),
  );

  return () => (shown() ? { label: label(), go } : undefined);
}

export function BackToEditor(props: {
  /** Small and borderless, for a header whose primary button should lead. */
  readonly quiet?: boolean;
}) {
  const target = useBackToEditor();
  return (
    <Show when={target()}>
      {(door) => (
        <IconButton
          data-testid="back-to-editor"
          variant={props.quiet === true ? "subtle" : "outlined"}
          size={props.quiet === true ? "sm" : "md"}
          label={door().label}
          tooltipSide="left"
          icon={<X />}
          onClick={() => door().go()}
        />
      )}
    </Show>
  );
}
