import { createFileRoute } from "@tanstack/solid-router";
import { Show } from "solid-js";

import { HistoryPanel, SavePanel } from "../app/ui/panels";
import { ShellGate } from "../app/ui/ShellGate";

/**
 * `/history` — the timeline, and `/history?review=1` — Save & Review.
 *
 * One route, two panels, because they are two views of one question: what has
 * changed since the last write, and what has been written since. Sharing the
 * URL keeps the back button meaningful (Save… → History is a navigation, not a
 * mode flag hidden in a signal) and keeps the sidebar's single History link
 * pointing at both.
 *
 * `review` is validated to `true` or absent rather than to a boolean, so the
 * history view's URL is the bare `/history` and never `?review=false`.
 */
interface HistorySearch {
  readonly review?: true;
}

function HistoryRoute() {
  const search = Route.useSearch();
  return (
    <Show when={search().review === true} fallback={<HistoryPanel />}>
      <SavePanel />
    </Show>
  );
}

export const Route = createFileRoute("/history")({
  validateSearch: (search: Record<string, unknown>): HistorySearch =>
    search.review === true || search.review === "1" || search.review === 1 ? { review: true } : {},
  head: () => ({ meta: [{ title: "Sefer — history" }] }),
  component: () => <ShellGate>{() => <HistoryRoute />}</ShellGate>,
});
