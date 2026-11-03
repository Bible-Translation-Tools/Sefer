import { createFileRoute } from "@tanstack/solid-router";

import { m } from "#app/paraglide/messages";
import { SuggestionsScreen } from "#app/ui/cloud";
import { ShellGate } from "#app/ui/ShellGate";

export const Route = createFileRoute("/_app/project/$slug/suggestions")({
  head: () => ({ meta: [{ title: m.page_title({ page: m.common_suggestions() }) }] }),
  component: () => <ShellGate>{() => <SuggestionsScreen />}</ShellGate>,
});
