import { HeadContent, Outlet, createRootRoute, useNavigate } from "@tanstack/solid-router";
import { Effect, Fiber, Stream } from "effect";
import { Show, createEffect, onCleanup, type ParentProps } from "solid-js";

import { t } from "#app/i18n";
import { applyLocale, uiLocale } from "#app/locale";
import { ProjectProvider, readyShell, useShellState } from "#app/ProjectContext";
import { shellKeys } from "#app/settings";
import "#app/ui/theme";

const useDesignSurface = (): void => {
  if (!__SEFER_DESIGN__) return;
  let stop: (() => void) | undefined;
  void import("#dev/designSurface").then(({ startDesignSurface }) => {
    stop = startDesignSurface();
  });
  onCleanup(() => {
    stop?.();
  });
};

/**
 * The screens, remounted when the interface language changes. Inside the
 * project shell on purpose: the open project, its books and their undo history
 * live in `ProjectProvider` and the services, so a language change redraws
 * every string and keeps every edit (Will, 2026-10-22).
 */
function LocaleScope(props: ParentProps) {
  const state = useShellState();
  createEffect(
    () => readyShell(state()),
    (shell) => {
      if (shell === undefined) return;
      const { settings, runtime } = shell.services;
      const key = shellKeys(settings).locale;
      applyLocale(settings.get(key));
      const watching = runtime.runFork(
        Stream.runForEach(settings.changes(key), (next) => Effect.sync(() => applyLocale(next))),
      );
      // Returned, not onCleanup: a Solid 2 effect's callback has no owner.
      return () => {
        Effect.runFork(Fiber.interrupt(watching));
      };
    },
  );
  return (
    <Show when={uiLocale()} keyed>
      {props.children}
    </Show>
  );
}

function Root() {
  const navigate = useNavigate();
  useDesignSurface();
  return (
    <>
      <HeadContent />
      <ProjectProvider navigate={navigate}>
        <LocaleScope>
          <Outlet />
        </LocaleScope>
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
