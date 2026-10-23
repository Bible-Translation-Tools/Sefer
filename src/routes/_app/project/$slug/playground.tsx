import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/solid-router";

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
