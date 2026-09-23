import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/solid-router";

/**
 * `/design` — the screens a designer is working on, and the only route whose
 * gate is not simply `import.meta.env.DEV`.
 *
 * It has to exist in two builds: the dev server somebody runs locally, and the
 * deployed prototype a product owner is sent a link to. That second one is a
 * production build, so `DEV` alone would switch it off exactly where it is
 * wanted. `__SEFER_DESIGN__` is the two-mode answer; `src/vite-env.d.ts` says
 * why it is a build flag rather than an env variable, and why it is a `define`
 * rather than an imported constant.
 *
 * Everything else is the pattern `/dev/fixture` established and for the same
 * reason: the page module is imported only inside the branch, so a real
 * production build contains none of `src/dev/design` and answers this path
 * through the root not-found boundary. `tools/verify/designBundle.ts` checks
 * that claim against an actual build rather than trusting the comment.
 *
 * There is no `$slug` under here. The design build seeds ONE project at a
 * fixed name, which is what makes a design URL shareable end to end — the
 * person opening the link does not have to already have the project.
 */
const loadDesignHome = async () => {
  if (__SEFER_DESIGN__) {
    const page = await import("#dev/design/DesignHome");
    return { default: page.DesignHome };
  }
  throw notFound();
};

export const Route = createFileRoute("/design")({
  beforeLoad: () => {
    if (!__SEFER_DESIGN__) throw notFound();
  },
  /**
   * Every string parameter is kept, and nothing else is declared.
   *
   * The other routes in this tree name their parameters one by one, because a
   * real screen has a fixed set and an unknown one is a bug. A design screen's
   * parameters ARE its dials, they change whenever somebody adds a knob, and a
   * schema here would have to be edited every time — which is the friction
   * that stops a designer from adding the knob. `screen` is the only key this
   * frame reads itself; the rest belong to whichever screen declared them, and
   * are namespaced by screen id so two screens' dials cannot collide.
   *
   * Non-strings are dropped rather than coerced: a design link is written by
   * hand and pasted into chat, so whatever survives that round trip is a
   * string anyway.
   */
  validateSearch: (search: Record<string, unknown>): Record<string, string> => {
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === "string" && value !== "") kept[key] = value;
    }
    return kept;
  },
  head: () => ({ meta: [{ title: "Sefer — design" }] }),
  component: lazyRouteComponent(loadDesignHome),
});
