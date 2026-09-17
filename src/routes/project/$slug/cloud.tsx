import { createFileRoute } from "@tanstack/solid-router";

import { CloudScreen } from "../../../app/ui/cloud";
import { ShellGate } from "../../../app/ui/ShellGate";

/**
 * `/cloud` — the sync screen, gated on the shell.
 *
 * Everything the screen does lives in `src/app/ui/cloud/CloudScreen.tsx`; this
 * file exists to name the URL and to say that the page needs services.
 */
export const Route = createFileRoute("/project/$slug/cloud")({
  head: () => ({ meta: [{ title: "Sefer — sync" }] }),
  component: () => <ShellGate>{() => <CloudScreen />}</ShellGate>,
});
