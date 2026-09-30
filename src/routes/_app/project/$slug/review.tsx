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
 * comparison is session state, not a place. The one exception is `against=
 * shared`, which is an address — the shared project, or with `pull=<n>` a
 * suggestion to it — and is how /cloud opens a review already set against
 * what arrived.
 */
export const Route = createFileRoute("/_app/project/$slug/review")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { readonly against?: "shared"; readonly pull?: number } => {
    if (search.against !== "shared") return {};
    // `pull` names a suggestion whose head was fetched for review; the shared
    // project's side then reads that instead of the tracking ref.
    const pull = Number(search.pull);
    return Number.isInteger(pull) && pull > 0 ? { against: "shared", pull } : { against: "shared" };
  },
  head: () => ({ meta: [{ title: "Sefer — review" }] }),
  component: () => <ShellGate>{() => <ReviewPanel />}</ShellGate>,
});
