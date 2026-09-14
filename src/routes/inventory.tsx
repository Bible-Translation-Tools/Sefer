import { createFileRoute } from "@tanstack/solid-router";

import { InventoryPanel } from "../app/ui/inventory";
import { ShellGate } from "../app/ui/ShellGate";

/**
 * `/inventory` — the character inventory, gated on the shell.
 *
 * Everything the screen does lives in `src/app/ui/inventory/`; this file exists
 * to name the URL and to say that the page needs services.
 */
export const Route = createFileRoute("/inventory")({
  head: () => ({ meta: [{ title: "Sefer — character inventory" }] }),
  component: () => <ShellGate>{() => <InventoryPanel />}</ShellGate>,
});
