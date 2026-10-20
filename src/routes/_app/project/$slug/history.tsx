import { createFileRoute, redirect } from "@tanstack/solid-router";

import { HistoryPanel } from "#app/ui/panels";
import { ShellGate } from "#app/ui/ShellGate";

interface HistorySearch {
  readonly review?: true;
  readonly commit?: string;
}

export const Route = createFileRoute("/_app/project/$slug/history")({
  validateSearch: (search: Record<string, unknown>): HistorySearch => ({
    ...(search.review === true || search.review === "1" || search.review === 1
      ? { review: true as const }
      : {}),
    ...(typeof search.commit === "string" && /^[0-9a-f]{4,64}$/u.test(search.commit)
      ? { commit: search.commit }
      : {}),
  }),
  beforeLoad: ({ search, params }) => {
    if (search.review === true)
      throw redirect({ to: "/project/$slug/review", params: { slug: params.slug } });
  },
  head: () => ({ meta: [{ title: "Sefer — history" }] }),
  component: () => <ShellGate>{() => <HistoryPanel />}</ShellGate>,
});
