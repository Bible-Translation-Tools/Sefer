import { Outlet, createFileRoute, useRouterState } from "@tanstack/solid-router";
import { Show, onCleanup, untrack } from "solid-js";

import { installCommandKeys } from "#app/commands";
import { t } from "#app/i18n";
import { readyShell, useShell, useShellState } from "#app/ProjectContext";
import { SIDEBAR_WIDTH } from "#app/settings";
import { CommandPalette } from "#app/ui/CommandPalette";
import { PageDoor, PageLeading, Resizable, Toaster } from "#app/ui/primitives";
import { AppBar } from "#app/ui/workspace/AppBar";
import { BackToEditor, useBackToEditorShown } from "#app/ui/workspace/BackToEditor";
import { usePanelToggleLeading } from "#app/ui/workspace/PanelToggle";
import { ProjectSidebar } from "#app/ui/workspace/ProjectSidebar";
import { sidebarClaim } from "#app/ui/workspace/sidebarSlot";

/**
 * The application shell, as a PATHLESS layout: the app bar, the project
 * sidebar, the palette and the status line, wrapped around every screen that
 * is part of the application.
 *
 * ## Why this is a route and not the root
 *
 * It used to live in `__root.tsx`, which meant every route in the tree
 * rendered inside the app bar — `/design` included. That is right for a design
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
 * "Overall layout"): a permanent APP BAR for "where in Sefer am I", and
 * under it a resizable project SIDEBAR for "where in this project am I",
 * which the projects page does without.
 *
 * Why the collapsed sidebar is hidden rather than unmounted: `Resizable`
 * registers its panels DURING render, in document order, so a conditionally
 * rendered panel would renumber the split — and unmounting the sidebar's
 * SIBLING (the panel holding the routed content) would destroy and rebuild the
 * editor's `EditorView` every time someone tapped the toggle. The canonical
 * text would survive that, because it lives in the Book; the reader's scroll
 * position and selection would not.
 */

function Workspace() {
  const shell = useShell();
  const path = useRouterState({ select: (state) => state.location.pathname });
  // Never on `/` or `/projects`. `/` is home: it forwards to the last project,
  // or draws `EmptyWorkspace` — a skeleton that draws its own sidebar.
  const showing = (): boolean => shell.sidebarShowing() && path() !== "/projects" && path() !== "/";
  // Plain variables, not expressions in the props: `Resizable.Panel` reads its
  // three sizes ONCE, during registration, and a JSX expression is a lazy memo
  // Solid 2 warns about when it is read outside a tracking scope. The width is
  // a one-time read by design — the persisted value seeds the split, and the
  // split owns it from there (primitives/Resizable.tsx) — so it is untracked
  // rather than merely read, which is the same statement said to the compiler.
  const initialWidth = untrack(() => shell.sidebarWidth());
  const minWidth = SIDEBAR_WIDTH.min;
  const maxWidth = SIDEBAR_WIDTH.max;
  const panelToggle = usePanelToggleLeading();
  const door = useBackToEditorShown();
  return (
    <Resizable.Root
      class="h-full"
      onSizesChange={(sizes) => {
        const first = sizes[0];
        if (first !== undefined) shell.setSidebarWidth(first);
      }}
    >
      <Resizable.Panel
        initialSize={initialWidth}
        minSize={minWidth}
        maxSize={maxWidth}
        // Dragged well past its narrowest, the panel closes instead.
        onCollapse={() => shell.setSidebarOpen(false)}
        collapseHint={{
          title: t("Keep dragging to close the panel"),
          detail: t("Release to keep it open."),
        }}
        class={showing() ? undefined : "hidden"}
      >
        {/* A screen of results may claim the panel for its own outline
            (`sidebarSlot.ts`); otherwise it is the project's contents.
            `keyed`: the next screen claims before the last one releases, so
            the claim goes from one render straight to another, and an
            unkeyed Show kept drawing the first — Findings' outline on Find. */}
        <Show when={sidebarClaim()} fallback={<ProjectSidebar />} keyed>
          {(render) => render()}
        </Show>
      </Resizable.Panel>
      {/* On the panel's own edge: dragging its border resizes it. */}
      <Resizable.Handle
        edge
        label={t("Resize the project panel")}
        class={showing() ? undefined : "hidden"}
      />
      {/* The `!` is load-bearing: `Resizable.Panel` writes its share as an
          inline `flex-basis`, and with the sidebar hidden the routed content
          has to take the whole row back. */}
      <Resizable.Panel class={showing() ? "min-w-0" : "min-w-0 [flex-basis:100%]!"}>
        {/* `relative`, and the door OUTSIDE the scroller: a full-page screen
            scrolls its own content, and a button that scrolled away with it
            would be a door you have to go back to the top to find. */}
        {/* The panel toggle for project screens without the editor's
            toolbar leads each screen's page header, inline with its title. */}
        <PageLeading value={panelToggle}>
          <PageDoor value={door}>
            <div class="relative h-full min-w-0">
              <BackToEditor />
              <div class="h-full overflow-y-auto">
                <Outlet />
              </div>
            </div>
          </PageDoor>
        </PageLeading>
      </Resizable.Panel>
    </Resizable.Root>
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
    <div class="flex h-screen flex-col bg-surface-canvas">
      <Show
        when={shell()}
        fallback={<div class="h-18 shrink-0 border-b border-surface-border bg-surface-primary" />}
      >
        <AppBar />
      </Show>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
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
