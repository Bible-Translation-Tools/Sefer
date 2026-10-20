import { Outlet, createFileRoute, useRouterState } from "@tanstack/solid-router";
import { Show, onCleanup, untrack } from "solid-js";

import { installCommandKeys } from "#app/commands";
import { t } from "#app/i18n";
import { readyShell, useShell, useShellState } from "#app/ProjectContext";
import { SIDEBAR_WIDTH } from "#app/settings";
import { TourOutlet } from "#app/tour/TourOutlet";
import { CommandPalette } from "#app/ui/CommandPalette";
import { PageDoor, PageLeading, Resizable, Toaster } from "#app/ui/primitives";
import { AppBar } from "#app/ui/workspace/AppBar";
import { BackToEditor } from "#app/ui/workspace/BackToEditor";
import { VersionTabs } from "#app/ui/workspace/ChangesHistorySidebar";
import { usePanelToggleLeading } from "#app/ui/workspace/PanelToggle";
import { ProjectSidebar } from "#app/ui/workspace/ProjectSidebar";
import { useScreen } from "#app/ui/workspace/screen";
import { sidebarClaim } from "#app/ui/workspace/sidebarSlot";

function WorkspacePage(props: {
  readonly toggle: ReturnType<typeof usePanelToggleLeading>;
  readonly tabs: ReturnType<ReturnType<typeof useScreen>["versionsTab"]> | undefined;
}) {
  return (
    <PageLeading value={props.toggle}>
      <PageDoor value={() => <BackToEditor />}>
        <div class="flex h-full min-w-0 flex-col">
          <Show when={props.tabs}>
            {(active) => (
              <div class="shrink-0 border-b border-surface-border px-4">
                <VersionTabs active={active()} inline />
              </div>
            )}
          </Show>
          <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </PageDoor>
    </PageLeading>
  );
}

function Workspace() {
  const shell = useShell();
  const path = useRouterState({ select: (state) => state.location.pathname });
  // Never on `/`, `/projects` or `/migrate`. `/` is home: it forwards to the
  // last project, or draws `EmptyWorkspace` — a skeleton that draws its own
  // sidebar. `/migrate` is building ANOTHER project and has its own book list;
  // the open project's sidebar there was only lost width (Will, 2026-10-07).
  const showing = (): boolean =>
    shell.sidebarShowing() && path() !== "/projects" && path() !== "/" && path() !== "/migrate";
  // Plain values: Resizable.Panel reads its sizes once, at registration; the split owns the width after.
  const initialWidth = untrack(() => shell.sidebarWidth());
  const minWidth = SIDEBAR_WIDTH.min;
  const maxWidth = SIDEBAR_WIDTH.max;
  const panelToggle = usePanelToggleLeading();
  const screen = useScreen();
  const pageTabs = () =>
    showing() || shell.project() === undefined ? undefined : screen.versionsTab();
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
        onCollapse={() => shell.setSidebarOpen(false)}
        collapseHint={{
          title: t("Keep dragging to close the panel"),
          detail: t("Release to keep it open."),
        }}
        class={showing() ? undefined : "hidden"}
      >
        <Show when={sidebarClaim()} fallback={<ProjectSidebar />} keyed>
          {(render) => render()}
        </Show>
      </Resizable.Panel>
      <Resizable.Handle
        edge
        label={t("Resize the project panel")}
        class={showing() ? undefined : "hidden"}
      />
      <Resizable.Panel class={showing() ? "min-w-0" : "min-w-0 [flex-basis:100%]!"}>
        <WorkspacePage toggle={panelToggle} tabs={pageTabs()} />
      </Resizable.Panel>
    </Resizable.Root>
  );
}

function Chrome() {
  const state = useShellState();

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
      <Show when={shell()}>
        <TourOutlet />
      </Show>
      <Toaster />
    </div>
  );
}

export const Route = createFileRoute("/_app")({
  component: Chrome,
});
