import { createFileRoute, redirect } from "@tanstack/solid-router";

/**
 * `/settings` — gone: Settings live under the open project
 * (`/project/$slug/settings`). An old link lands on the projects page, where
 * a project is opened first.
 */
export const Route = createFileRoute("/_app/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/projects" });
  },
});
