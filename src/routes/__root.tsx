import { HeadContent, Outlet, createRootRoute } from "@tanstack/solid-router";

// The root route: the site-wide layout every route renders inside, plus the
// not-found boundary. <HeadContent /> renders whatever the matched routes
// declare in their `head` options (titles here).
export const Route = createRootRoute({
  head: () => ({ meta: [{ title: "Sefer" }] }),
  component: () => (
    <>
      <HeadContent />
      <Outlet />
    </>
  ),
  notFoundComponent: () => <main>Page not found.</main>,
});
