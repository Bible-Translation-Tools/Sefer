import { createFileRoute, redirect } from "@tanstack/solid-router";

import { HistoryPanel } from "#app/ui/panels";
import { ShellGate } from "#app/ui/ShellGate";

/**
 * `/history` — the commit timeline.
 *
 * `?review=1` is a REDIRECT to `/review` rather than a second panel, because
 * the timeline and the review are views of one question: Mod-S, the toolbar
 * and the command palette all send `/history?review=1`, and they all land on
 * the review.
 *
 * `review` is validated to `true` or absent rather than to a boolean, so the
 * history view's URL is the bare `/history` and never `?review=false`.
 */
interface HistorySearch {
  readonly review?: true;
}

export const Route = createFileRoute("/_app/project/$slug/history")({
  validateSearch: (search: Record<string, unknown>): HistorySearch =>
    search.review === true || search.review === "1" || search.review === 1 ? { review: true } : {},
  beforeLoad: ({ search, params }) => {
    if (search.review === true)
      throw redirect({ to: "/project/$slug/review", params: { slug: params.slug } });
  },
  head: () => ({ meta: [{ title: "Sefer — history" }] }),
  component: () => <ShellGate>{() => <HistoryPanel />}</ShellGate>,
});
