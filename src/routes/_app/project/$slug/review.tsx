import { createFileRoute } from "@tanstack/solid-router";

import { ReviewPanel } from "#app/ui/review";
import { ShellGate } from "#app/ui/ShellGate";

/**
 * `/review` — the one review screen, gated on the shell.
 *
 * One screen for "which of these two texts do I keep", whichever two they are.
 * `/history?review=1` redirects here, and `/history` keeps the commit
 * timeline — the screen about what HAS happened rather than what is about to.
 *
 * Everything the screen does lives in `src/app/ui/review/`. The comparison is
 * not a search param: a picked zip has no address to put in one, and a frozen
 * comparison is session state, not a place.
 */
export const Route = createFileRoute("/_app/project/$slug/review")({
  head: () => ({ meta: [{ title: "Sefer — review" }] }),
  component: () => <ShellGate>{() => <ReviewPanel />}</ShellGate>,
});
