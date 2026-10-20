import { HeadContent, Outlet, createRootRoute, useNavigate } from "@tanstack/solid-router";
import { onCleanup } from "solid-js";

import { t } from "#app/i18n";
import { ProjectProvider } from "#app/ProjectContext";
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

function Root() {
  const navigate = useNavigate();
  useDesignSurface();
  return (
    <>
      <HeadContent />
      <ProjectProvider navigate={navigate}>
        <Outlet />
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
