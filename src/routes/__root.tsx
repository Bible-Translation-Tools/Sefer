import { HeadContent, Link, Outlet, createRootRoute, useNavigate } from "@tanstack/solid-router";
import FolderOpen from "lucide-solid/icons/folder-open";
import HistoryIcon from "lucide-solid/icons/history";
import SearchIcon from "lucide-solid/icons/search";
import SettingsIcon from "lucide-solid/icons/settings";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { For, Show, onCleanup } from "solid-js";

import { installCommandKeys, runCommand } from "../app/commands";
import { t } from "../app/i18n";
import { ProjectProvider, readyShell, useShellState } from "../app/ProjectContext";
import { CommandPalette } from "../app/ui/CommandPalette";
import { Kbd, Toaster } from "../app/ui/primitives";

/**
 * The application shell: the sidebar, the palette, the status line, and the
 * one <ProjectProvider> every route reads.
 *
 * The provider is here rather than in `src/App.tsx` because it needs the
 * router's `navigate` — a command that jumps to a finding is navigation — and
 * because App.tsx owns exactly one thing, the composition.
 *
 * The sidebar is a WHITE panel and a plain vertical nav list
 * (planning/03-ui/design-direction.md). It is deliberately not the project
 * sidebar the mockups describe — the book list, the chapter grid, the
 * collapse-to-rail — because that one belongs to the open project and is built
 * with the workspace, not under it.
 */

const NAV = [
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/findings", label: "Findings", icon: TriangleAlert },
  { to: "/find", label: "Find", icon: SearchIcon },
  { to: "/history", label: "History", icon: HistoryIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

function Chrome() {
  const state = useShellState();

  // The shell's chords, on the document. CodeMirror sees a keystroke inside the
  // editor first, so nothing here competes with an editor binding. Guarded
  // because the production build prerenders this shell under Node.
  if (typeof document !== "undefined") onCleanup(installCommandKeys(document));

  const shell = () => readyShell(state());

  return (
    <div class="grid min-h-screen grid-cols-[14rem_1fr] bg-surface-secondary">
      <nav class="flex flex-col gap-0.5 border-e border-sidebar-border bg-sidebar-surface p-3">
        {/* Not a heading: the landing route already owns the page's h1, and two
            "Sefer" headings would make the accessibility tree ambiguous. */}
        <div class="px-2 pb-3 text-h4 font-bold text-on-surface-primary">{t("Sefer")}</div>
        <For each={NAV}>
          {(item) => (
            <Link
              to={item.to}
              class="flex items-center gap-2 rounded-md px-2 py-1.5 text-small text-sidebar-on-surface-muted no-underline transition-colors hover:bg-sidebar-surface-hover hover:text-sidebar-on-surface"
              activeProps={{
                "data-status": "active",
                class: "bg-sidebar-surface-active font-medium text-brand",
              }}
            >
              <item.icon size={16} aria-hidden="true" />
              {t(item.label)}
            </Link>
          )}
        </For>
        <button
          type="button"
          class="mt-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-small text-sidebar-on-surface-muted transition-colors hover:bg-sidebar-surface-hover hover:text-sidebar-on-surface"
          onClick={() => runCommand("palette.open")}
        >
          {t("Commands")}
          <Kbd class="ms-auto">Mod-K</Kbd>
        </button>
        <footer class="mt-auto space-y-0.5 px-2 pt-3 text-smallest text-on-surface-tertiary">
          <Show when={shell()} fallback={<span>{t("starting…")}</span>}>
            {(ready) => (
              <>
                <div data-storage={ready().services.storage}>{ready().services.storage}</div>
                <div>{ready().status()}</div>
              </>
            )}
          </Show>
        </footer>
      </nav>
      <Outlet />
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
