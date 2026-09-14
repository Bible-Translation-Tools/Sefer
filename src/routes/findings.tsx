import { createFileRoute } from "@tanstack/solid-router";

import { FindingsPanel } from "../app/ui/panels";
import { ShellGate } from "../app/ui/ShellGate";

/**
 * `/findings` — the panel, gated on the shell.
 *
 * Everything the screen does lives in `src/app/ui/panels/FindingsPanel.tsx`;
 * this file exists to name the URL and to say that the page needs services.
 */
export const Route = createFileRoute("/findings")({
  head: () => ({ meta: [{ title: "Sefer — findings" }] }),
  component: () => <ShellGate>{() => <FindingsPanel />}</ShellGate>,
});
