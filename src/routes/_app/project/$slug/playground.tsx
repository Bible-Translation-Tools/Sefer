import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/solid-router";

/**
 * `/project/$slug/playground` — a prototype room for trying UI on real text.
 *
 * Gated the way `/design` is (`__SEFER_DESIGN__`), so it is on the dev server
 * AND the deployed `dev` channel, where a product owner can be sent a link,
 * and never in production: the branch below is unreachable there, so nothing
 * under `src/dev/playground` — the experiments, the synthetic draft, the
 * `import.meta.glob` of untracked sketches — enters the bundle, and the path
 * is the not-found boundary. `pnpm verify:design` checks that against real
 * builds; `documentation/dev-only-routes.md` lists every route gated this way.
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
  if (__SEFER_DESIGN__) {
    const page = await import("#dev/playground/PlaygroundPage");
    return { default: page.PlaygroundPage };
  }
  throw notFound();
};

export const Route = createFileRoute("/_app/project/$slug/playground")({
  beforeLoad: () => {
    if (!__SEFER_DESIGN__) throw notFound();
  },
  /**
   * Every string parameter is kept, and nothing is declared — the same bargain
   * `/design` makes, for the same reason. An experiment's parameters ARE its
   * dials; they change whenever somebody adds a knob, and a schema here would
   * need editing every time, which is exactly the friction that stops the knob
   * being added. Dial keys are namespaced by experiment id, so two experiments
   * may both have a `layout` without inheriting each other's answer.
   */
  validateSearch: (search: Record<string, unknown>): Record<string, string> => {
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === "string" && value !== "") kept[key] = value;
    }
    return kept;
  },
  head: () => ({ meta: [{ title: "Sefer — playground" }] }),
  component: lazyRouteComponent(loadPlayground),
});
