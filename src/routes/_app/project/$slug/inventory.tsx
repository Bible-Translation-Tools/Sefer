import { createFileRoute } from "@tanstack/solid-router";

import { InventoryPanel } from "#app/ui/inventory";
import { ShellGate } from "#app/ui/ShellGate";

export const Route = createFileRoute("/_app/project/$slug/inventory")({
  head: () => ({ meta: [{ title: "Sefer — character inventory" }] }),
  component: () => <ShellGate>{() => <InventoryPanel />}</ShellGate>,
});
