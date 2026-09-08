import { HeadContent, Link, Outlet, createRootRoute, useNavigate } from "@tanstack/solid-router";
import { For, Show, onCleanup } from "solid-js";

import { installCommandKeys, runCommand } from "../app/commands";
import { t } from "../app/i18n";
import { ProjectProvider, readyShell, useShellState } from "../app/ProjectContext";
import { CommandPalette } from "../app/ui/CommandPalette";

/**
 * The application shell: the sidebar, the palette, the status line, and the
 * one <ProjectProvider> every route reads.
 *
 * The provider is here rather than in `src/App.tsx` because it needs the
 * router's `navigate` — a command that jumps to a finding is navigation — and
 * because App.tsx owns exactly one thing, the composition.
 */

const NAV = [
  { to: "/projects", label: "Projects" },
  { to: "/findings", label: "Findings" },
  { to: "/find", label: "Find" },
  { to: "/history", label: "History" },
  { to: "/settings", label: "Settings" },
] as const;

function Chrome() {
  const state = useShellState();

  // The shell's chords, on the document. CodeMirror sees a keystroke inside the
  // editor first, so nothing here competes with an editor binding. Guarded
  // because the production build prerenders this shell under Node.
  if (typeof document !== "undefined") onCleanup(installCommandKeys(document));

  const shell = () => readyShell(state());

  return (
    <div class="app">
      <nav class="app-sidebar">
        {/* Not a heading: the landing route already owns the page's h1, and two
            "Sefer" headings would make the accessibility tree ambiguous. */}
        <div class="brand">{t("Sefer")}</div>
        <For each={NAV}>
          {(item) => (
            <Link to={item.to} activeProps={{ "data-status": "active" }}>
              {t(item.label)}
            </Link>
          )}
        </For>
        <button type="button" data-variant="tertiary" onClick={() => runCommand("palette.open")}>
          {t("Commands")} <kbd>Mod-K</kbd>
        </button>
        <footer>
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
  notFoundComponent: () => <main class="plain">{t("Page not found.")}</main>,
});
