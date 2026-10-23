import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/solid-router";

const loadFixturePage = async () => {
  if (import.meta.env.DEV) {
    const page = await import("#dev/FixturePage");
    return { default: page.FixturePage };
  }
  throw notFound();
};

export const Route = createFileRoute("/_app/dev/fixture")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Sefer fixture" }] }),
  component: lazyRouteComponent(loadFixturePage),
});
