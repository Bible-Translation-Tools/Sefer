import { createFileRoute, useLocation } from "@tanstack/solid-router";

import { OpenByLink } from "#app/ui/landing/OpenByLink";
import { ShellGate } from "#app/ui/ShellGate";
import "#app/ui/theme";

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
