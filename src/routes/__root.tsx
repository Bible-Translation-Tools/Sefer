import { HeadContent, Outlet, createRootRoute, useNavigate } from "@tanstack/solid-router";
import { Show, onCleanup, untrack } from "solid-js";

import { installCommandKeys, runCommand } from "../app/commands";
import { t } from "../app/i18n";
import { ProjectProvider, readyShell, useShell, useShellState } from "../app/ProjectContext";
import { SIDEBAR_WIDTH } from "../app/settings";
import { CommandPalette } from "../app/ui/CommandPalette";
import { Kbd, Resizable, Toaster } from "../app/ui/primitives";
import { IconRail } from "../app/ui/workspace/IconRail";
import { ProjectSidebar } from "../app/ui/workspace/ProjectSidebar";
// The appearance applier, imported for its side effect and imported HERE: it
// writes the cached theme, interface size and scripture size onto <html> at
// module load, and the root route is the one module every screen goes through.
import "../app/ui/theme";

/**
 * The application shell: the icon rail, the project sidebar, the palette, the
 * status line, and the one <ProjectProvider> every route reads.
 *
 * The provider is here rather than in `src/App.tsx` because it needs the
 * router's `navigate` — a command that jumps to a finding is navigation — and
 * because App.tsx owns exactly one thing, the composition.
 *
 * The chrome is the mockups' workspace (planning/03-ui/design-direction.md,
 * "Overall layout"): a permanent icon RAIL for "where in Sefer am I", and
 * beside it a resizable project SIDEBAR for "where in this project am I". The
 * rail's panel toggle collapses the second, never the first.
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
  // Plain variables, not expressions in the props: `Resizable.Panel` reads its
  // three sizes ONCE, during registration, and a JSX expression is a lazy memo
  // Solid 2 warns about when it is read outside a tracking scope. The width is
  // a one-time read by design — the persisted value seeds the split, and the
  // split owns it from there (primitives/Resizable.tsx) — so it is untracked
  // rather than merely read, which is the same statement said to the compiler.
  const initialWidth = untrack(() => shell.sidebarWidth());
  const minWidth = SIDEBAR_WIDTH.min;
  const maxWidth = SIDEBAR_WIDTH.max;
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
        class={shell.sidebarShowing() ? undefined : "hidden"}
      >
        <ProjectSidebar />
      </Resizable.Panel>
      <Resizable.Handle
        label={t("Resize the project panel")}
        class={shell.sidebarShowing() ? undefined : "hidden"}
      />
      {/* The `!` is load-bearing: `Resizable.Panel` writes its share as an
          inline `flex-basis`, and with the sidebar hidden the routed content
          has to take the whole row back. */}
      <Resizable.Panel class={shell.sidebarShowing() ? undefined : "[flex-basis:100%]!"}>
        <div class="h-full overflow-y-auto">
          <Outlet />
        </div>
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
    <div class="flex h-screen bg-surface-secondary">
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
        <footer class="flex items-center gap-3 border-t border-sidebar-border bg-surface-primary px-3 py-1 text-smallest text-on-surface-tertiary">
          <Show when={shell()} fallback={<span>{t("starting…")}</span>}>
            {(ready) => (
              <>
                <span data-storage={ready().services.storage}>{ready().services.storage}</span>
                <span class="truncate">{ready().status()}</span>
                <button
                  type="button"
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

function Root() {
  const navigate = useNavigate();
  return (
    <>
      <HeadContent />
      <ProjectProvider
        go={(path) => {
          // SAFETY: `to` is a typed route literal union, and these paths are
          // built at runtime from a project root and a book id. The router
          // resolves an unknown path through its own not-found boundary, so a
          // wrong string is a 404, never a crash.
          void navigate({ to: path as never });
        }}
      >
        <Chrome />
      </ProjectProvider>
    </>
  );
}

export const Route = createRootRoute({
  head: () => ({ meta: [{ title: "Sefer" }] }),
  component: Root,
  notFoundComponent: () => (
    <main class="mx-auto w-full max-w-3xl p-10 text-small text-on-surface-tertiary">
      {t("Page not found.")}
    </main>
  ),
});
