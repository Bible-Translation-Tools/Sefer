import { createFileRoute } from "@tanstack/solid-router";

import { SuggestionsScreen } from "#app/ui/cloud";
import { ShellGate } from "#app/ui/ShellGate";

/** `/suggestions` — the editors' list of suggested changes; see `SuggestionsScreen`. */
export const Route = createFileRoute("/_app/project/$slug/suggestions")({
  head: () => ({ meta: [{ title: "Sefer — suggestions" }] }),
  component: () => <ShellGate>{() => <SuggestionsScreen />}</ShellGate>,
});
