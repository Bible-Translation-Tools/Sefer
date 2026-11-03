import { createFileRoute } from "@tanstack/solid-router";

import { m } from "#app/paraglide/messages";
import { InventoryPanel } from "#app/ui/inventory";
import { ShellGate } from "#app/ui/ShellGate";

export const Route = createFileRoute("/_app/project/$slug/inventory")({
  head: () => ({ meta: [{ title: m.page_title({ page: m.page_inventory() }) }] }),
  component: () => <ShellGate>{() => <InventoryPanel />}</ShellGate>,
});
