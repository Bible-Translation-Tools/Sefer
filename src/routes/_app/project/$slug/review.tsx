import { createFileRoute } from "@tanstack/solid-router";

import { ReviewPanel } from "#app/ui/review";
import { ShellGate } from "#app/ui/ShellGate";

export const Route = createFileRoute("/_app/project/$slug/review")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { readonly against?: "shared" | "writer"; readonly pull?: number; readonly copy?: 1 } => {
    if (search.against === "writer") return { against: "writer" };
    if (search.against !== "shared") return {};
    if (Number(search.copy) === 1) return { against: "shared", copy: 1 };
    const pull = Number(search.pull);
    return Number.isInteger(pull) && pull > 0 ? { against: "shared", pull } : { against: "shared" };
  },
  head: () => ({ meta: [{ title: "Sefer — review" }] }),
  component: () => <ShellGate>{() => <ReviewPanel />}</ShellGate>,
});
