import { createFileRoute, useLocation } from "@tanstack/solid-router";

import { OpenByLink } from "#app/ui/landing/OpenByLink";
import { ShellGate } from "#app/ui/ShellGate";
import "#app/ui/theme";

/**
 * `/r/$owner/$repo/…` — a share link: a place in a project, named by the
 * shared project it came from rather than this device's slug for it
 * (`core/project/shareLink.ts`). The splat is the place, `/book/JHN` or
 * empty, and is handed on unchanged to `/project/<slug>`.
 */

function Arrival() {
  const params = Route.useParams();
  const location = useLocation();
  return (
    <OpenByLink
      owner={params().owner}
      repo={params().repo}
      rest={params()._splat ? `/${params()._splat}` : ""}
      searchStr={location().searchStr}
    />
  );
}

export const Route = createFileRoute("/_app/r/$owner/$repo/$")({
  head: () => ({ meta: [{ title: "Opening a link · Sefer" }] }),
  component: () => <ShellGate>{() => <Arrival />}</ShellGate>,
});
