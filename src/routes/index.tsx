import { createFileRoute } from "@tanstack/solid-router";

import { ProjectsLanding } from "../app/ui/landing/ProjectsLanding";
import { ShellGate } from "../app/ui/ShellGate";
import "../app/ui/theme";

/**
 * `/` IS the landing screen, not a redirect to it.
 *
 * A redirect would be tidier in the route tree and worse in practice: the
 * composition reads `?fixture=1` off `location` before the router exists, and a
 * redirect that dropped the search would silently compose over OPFS instead of
 * the seeded fixture. Rendering the same component from both paths costs one
 * import and cannot lose a query string.
 */

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Sefer" }] }),
  component: () => <ShellGate>{() => <ProjectsLanding />}</ShellGate>,
});
