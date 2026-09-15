import { createFileRoute } from "@tanstack/solid-router";

import { ComparePanel } from "../app/ui/compare";
import { ShellGate } from "../app/ui/ShellGate";

/**
 * `/compare` — the symmetric review, gated on the shell.
 *
 * Everything the screen does lives in `src/app/ui/compare/`; this file exists
 * to name the URL and to say that the page needs services. The comparison
 * itself is not a search param: a picked zip has no address to put in one, and
 * a frozen comparison is session state, not a place.
 */
export const Route = createFileRoute("/compare")({
  head: () => ({ meta: [{ title: "Sefer — compare" }] }),
  component: () => <ShellGate>{() => <ComparePanel />}</ShellGate>,
});
