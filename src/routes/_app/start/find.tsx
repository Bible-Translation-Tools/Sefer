import { Navigate, createFileRoute } from "@tanstack/solid-router";

/**
 * There is no separate find screen any more: the WACS catalogue is the second
 * section of the projects page. The route stays so old links and bookmarks
 * land somewhere; `search` is carried so `?fixture=1` survives.
 */
export const Route = createFileRoute("/_app/start/find")({
  component: () => <Navigate to="/projects" search={true} replace />,
});
