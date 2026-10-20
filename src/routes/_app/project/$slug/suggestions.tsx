import { createFileRoute } from "@tanstack/solid-router";

import { SuggestionsScreen } from "#app/ui/cloud";
import { ShellGate } from "#app/ui/ShellGate";

export const Route = createFileRoute("/_app/project/$slug/suggestions")({
  head: () => ({ meta: [{ title: "Sefer — suggestions" }] }),
  component: () => <ShellGate>{() => <SuggestionsScreen />}</ShellGate>,
});
