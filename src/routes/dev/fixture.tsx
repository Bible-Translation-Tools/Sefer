import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/solid-router";

// The route is generated into the tree in every build; the page module is not.
// `import.meta.env.DEV` is a build-time constant, so the branch below is
// unreachable in a production build and the fixture code — the `?raw` USFM, the
// seeded memory FileSystem, the `__sefer` dev state — never enters the bundle.
// Production answers /dev/fixture through the root not-found boundary.
const loadFixturePage = async () => {
  if (import.meta.env.DEV) {
    const page = await import("../../dev/FixturePage");
    return { default: page.FixturePage };
  }
  throw notFound();
};

export const Route = createFileRoute("/dev/fixture")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Sefer fixture" }] }),
  component: lazyRouteComponent(loadFixturePage),
});
