import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/solid-router";

/**
 * `/project/$slug/playground` — a dev-only room for trying UI on real text.
 *
 * Gated exactly the way `/dev/fixture` is, and for the same reason:
 * `import.meta.env.DEV` is a build-time constant, so the branch below is
 * unreachable in a production build and nothing under `src/dev/playground` —
 * the experiments, the synthetic draft, the `import.meta.glob` of untracked
 * sketches — enters the bundle. Production answers the path with the not-found
 * boundary.
 *
 * It lives UNDER the project rather than beside `/dev/fixture` on purpose: the
 * parent route has already opened the project by the time a child renders, so
 * an experiment is handed real books, real USFM and the real engine without
 * opening anything itself. That is the difference between a component gallery
 * and a place where a design can actually be judged.
 *
 * The page supplies its own `ShellGate`, so nothing here has to be imported
 * eagerly to wrap it.
 */
const loadPlayground = async () => {
  if (import.meta.env.DEV) {
    const page = await import("../../../dev/playground/PlaygroundPage");
    return { default: page.PlaygroundPage };
  }
  throw notFound();
};

export const Route = createFileRoute("/project/$slug/playground")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Sefer — playground" }] }),
  component: lazyRouteComponent(loadPlayground),
});
