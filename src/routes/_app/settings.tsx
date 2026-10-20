import { createFileRoute, redirect } from "@tanstack/solid-router";

export const Route = createFileRoute("/_app/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/projects" });
  },
});
