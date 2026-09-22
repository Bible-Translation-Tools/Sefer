import { createFileRoute, redirect } from "@tanstack/solid-router";

/**
 * `/compare` — kept as a REDIRECT to `/review`.
 *
 * Compare and Save & Review became one screen (Will, 2026-09-15: "yes on one
 * screen"). The URL stays because the icon rail, the command palette and any
 * bookmark still name it, and a route that 404s is a worse answer than a route
 * that takes you where the screen went. It carries no component: the redirect
 * happens before anything renders.
 */
export const Route = createFileRoute("/_app/project/$slug/compare")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/project/$slug/review", params: { slug: params.slug } });
  },
});
