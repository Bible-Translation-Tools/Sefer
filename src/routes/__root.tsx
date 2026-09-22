import { HeadContent, Outlet, createRootRoute, useNavigate } from "@tanstack/solid-router";
import { onCleanup } from "solid-js";

import { t } from "../app/i18n";
import { ProjectProvider } from "../app/ProjectContext";
// The appearance applier, imported for its side effect and imported HERE: it
// writes the cached theme, interface size and scripture size onto <html> at
// module load, and the root route is the one module every screen goes through.
import "../app/ui/theme";

/**
 * What every screen needs whatever frame it is in: the head, the one
 * `<ProjectProvider>`, and the design annotator.
 *
 * The application's CHROME — the icon rail, the project sidebar, the palette,
 * the status line — is deliberately NOT here. It lives in `_app.tsx`, a
 * pathless layout, and the screens that belong inside the workspace are the
 * ones under it. Anything outside that layout, `/design` above all, is a blank
 * canvas: still composed, still themed, still commentable, but not wearing a
 * frame it is not part of. The reasoning is written down in `_app.tsx`.
 *
 * The provider is here rather than in `src/App.tsx` because it needs the
 * router's `navigate` — a command that jumps to a finding is navigation — and
 * because App.tsx owns exactly one thing, the composition.
 */

/**
 * The design annotator, on every route rather than only on `/design`.
 *
 * A remark like "this input does not autofocus when the dialog opens" is about
 * a REAL screen, and the whole point of pointing at a pixel is being able to do
 * it wherever the pixel is. Comment-only and minimised to a puck out here; see
 * `src/dev/designSurface.ts` for why there is exactly one instance and why the
 * hotkey is off by default.
 *
 * It stays on the ROOT rather than moving down with the chrome, and that is the
 * point of it: a comment about the workspace and a comment about a prototype
 * are the same gesture, and a panel that only existed inside one frame would
 * be a panel you cannot use to compare them.
 *
 * A dynamic import inside the build-time branch, which is how every other
 * dev-only surface in this tree is reached — a static import would put the
 * panel in a production bundle, and `pnpm boundaries` refuses one from here.
 */
const useDesignSurface = (): void => {
  if (!__SEFER_DESIGN__) return;
  let stop: (() => void) | undefined;
  void import("../dev/designSurface").then((surface) => {
    stop = surface.startDesignSurface();
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
      {/* The router's own navigate, handed down as-is. Not wrapped in a
          `go(path: string)`: that shape forced every caller to cast past the
          typed route union, which is the one thing this router is for. */}
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
