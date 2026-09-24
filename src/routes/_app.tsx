import { Outlet, createFileRoute, useRouterState } from "@tanstack/solid-router";
import { Show, onCleanup } from "solid-js";

import { installCommandKeys, runCommand } from "#app/commands";
import { t } from "#app/i18n";
import { readyShell, useShell, useShellState } from "#app/ProjectContext";
import { CommandPalette } from "#app/ui/CommandPalette";
import { Kbd, Toaster } from "#app/ui/primitives";
import { BackToEditor } from "#app/ui/workspace/BackToEditor";
import { IconRail } from "#app/ui/workspace/IconRail";
import { ProjectSidebar } from "#app/ui/workspace/ProjectSidebar";

/**
 * The application shell, as a PATHLESS layout: the icon rail, the project
 * sidebar, the palette and the status line, wrapped around every screen that
 * is part of the application.
 *
 * ## Why this is a route and not the root
 *
 * It used to live in `__root.tsx`, which meant every route in the tree
 * rendered inside the rail — `/design` included. That is right for a design
 * screen which genuinely sits inside the workspace and wrong for onboarding,
 * a project list, or anything full-bleed: a designer judging a screen could
 * not see its real framing, only this one.
 *
 * The alternative considered was a frame-level dial (`?chrome=0`) read in the
 * root. It was rejected because "is this screen inside the application frame"
 * is a structural fact about a screen, and a query parameter answers it at
 * runtime, from a URL somebody can mistype or share. Expressed as a layout it
 * is visible in the file tree, cannot be got wrong by accident, and `/design`
 * is a blank canvas because of WHERE IT IS rather than because of a flag.
 *
 * What `__root` keeps is what every screen needs whatever its frame: the head,
 * the one `ProjectProvider`, and the design annotator. A prototype on
 * `/design` still has services, a theme and the comment panel; what it does
 * not have is this chrome — nor the shell's chords, since `installCommandKeys`
 * is here. A prototype answering the application's Mod-K would be answering
 * for an application it is not part of.
 *
 * The chrome is the mockups' workspace (`documentation/architecture/design-direction.md`,
 * "Overall layout"): a permanent icon RAIL for "where in Sefer am I", and
 * beside it a fixed 320px project SIDEBAR for "where in this project am I".
 *
 * The collapsed sidebar is hidden rather than unmounted, so the routed
 * content beside it (and the editor's `EditorView` inside that) is never
 * torn down and rebuilt when the sidebar comes and goes.
 */

function Workspace() {
  const shell = useShell();
  const path = useRouterState({ select: (state) => state.location.pathname });
  // Never on the projects page: `/projects`, and `/` whenever it is drawing
  // that page. The first-run shell on `/` keeps it — the sidebar's project
  // control is that screen's one way in.
  const onProjectsPage = (): boolean =>
    path() === "/projects" || (path() === "/" && !shell.firstRun());
  return (
    <div class="flex h-full">
      <div class={shell.sidebarShowing() && !onProjectsPage() ? "w-80 shrink-0" : "hidden"}>
        <ProjectSidebar />
      </div>
      {/* `relative`, and the door OUTSIDE the scroller: a full-page screen
          scrolls its own content, and a button that scrolled away with it
          would be a door you have to go back to the top to find. */}
      <div class="relative h-full min-w-0 flex-1">
        <BackToEditor />
        <div class="h-full overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function Chrome() {
  const state = useShellState();

  // The shell's chords, on the document. CodeMirror sees a keystroke inside the
  // editor first, so nothing here competes with an editor binding. Guarded
  // because the production build prerenders this shell under Node.
  if (typeof document !== "undefined") onCleanup(installCommandKeys(document));

  const shell = () => readyShell(state());

  return (
    <div class="flex h-screen bg-surface-canvas">
      <Show
        when={shell()}
        fallback={<div class="w-13 shrink-0 border-e border-sidebar-border bg-surface-primary" />}
      >
        <IconRail />
      </Show>

      <div class="flex min-w-0 flex-1 flex-col">
        <div class="min-h-0 flex-1">
          <Show
            when={shell()}
            fallback={
              <div class="h-full overflow-y-auto">
                <Outlet />
              </div>
            }
          >
            <Workspace />
          </Show>
        </div>

        {/* The status line, one compact row at the foot of the content column.
            It is the shell's only permanent readout — which storage this
            composition got, what the last operation said, and the one chord
            that reaches everything else. */}
        <footer
          data-testid="status-line"
          class="flex items-center gap-3 border-t border-sidebar-border bg-surface-primary px-3 py-1 text-smallest text-on-surface-tertiary"
        >
          <Show when={shell()} fallback={<span>{t("starting…")}</span>}>
            {(ready) => (
              <>
                <span data-storage={ready().services.storage}>{ready().services.storage}</span>
                <span class="truncate">{ready().status()}</span>
                <button
                  type="button"
                  data-testid="status-commands"
                  class="ms-auto flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-surface-secondary hover:text-on-surface-secondary"
                  onClick={() => runCommand("palette.open")}
                >
                  {t("Commands")}
                  <Kbd>Mod-K</Kbd>
                </button>
              </>
            )}
          </Show>
        </footer>
      </div>

      <Show when={shell()}>
        {(ready) => (
          <CommandPalette
            open={ready().paletteOpen()}
            onClose={() => ready().setPaletteOpen(false)}
          />
        )}
      </Show>
      <Toaster />
    </div>
  );
}

export const Route = createFileRoute("/_app")({
  component: Chrome,
});
