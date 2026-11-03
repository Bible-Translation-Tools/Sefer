import { useNavigate } from "@tanstack/solid-router";
import X from "lucide-solid/icons/x";
import { Show, onCleanup } from "solid-js";

import { m } from "#app/paraglide/messages";

import { registerCommand } from "../../commands";
import { useShell } from "../../ProjectContext";
import { IconButton } from "../primitives";
import { bookName } from "./books";
import { metadataOf } from "./project";
import { useScreen } from "./screen";

interface BackToEditorTarget {
  readonly label: string;
  readonly go: () => void;
}

// fallow-ignore-next-line unused-export
export function useBackToEditor(): () => BackToEditorTarget | undefined {
  const shell = useShell();
  const navigate = useNavigate();
  const screen = useScreen();

  const label = (): string => {
    const project = shell.project();
    if (project === undefined) return m.workspace_back_to_the_editor();
    const held = shell.lastLocation(project.root);
    if (held === undefined) return m.workspace_back_to_the_project();
    return m.workspace_back_to_book({ book: bookName(held.bookId, metadataOf(project)) });
  };

  const go = (): void => {
    void navigate({ to: "/project/$slug", params: { slug: shell.slug() } });
  };

  const shown = (): boolean => screen.inProject() && shell.project() !== undefined;

  onCleanup(
    registerCommand({
      id: "editor.back",
      title: m.workspace_back_to_the_editor,
      when: shown,
      run: go,
    }),
  );

  return () => (shown() ? { label: label(), go } : undefined);
}

export function BackToEditor(props: { readonly quiet?: boolean }) {
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
