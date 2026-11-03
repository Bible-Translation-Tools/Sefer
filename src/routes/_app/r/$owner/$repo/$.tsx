import { createFileRoute, useLocation } from "@tanstack/solid-router";

import { m } from "#app/paraglide/messages";
import { OpenByLink } from "#app/ui/landing/OpenByLink";
import "#app/ui/theme";
import { ShellGate } from "#app/ui/ShellGate";

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
  head: () => ({ meta: [{ title: m.page_title({ page: m.page_opening_link() }) }] }),
  component: () => <ShellGate>{() => <Arrival />}</ShellGate>,
});
