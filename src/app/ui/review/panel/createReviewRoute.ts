import { useSearch } from "@tanstack/solid-router";
import { untrack } from "solid-js";

import type { Shell } from "../../../ProjectContext";
import { copyRef, suggestionRef } from "../../../suggestions";
import { syncWatch } from "../../../syncWatch";

export function createReviewRoute(shell: Shell) {
  const search = useSearch({ from: "/_app/project/$slug/review" });
  const pull = (): number | undefined => untrack(() => search().pull);
  const fromCopy = (): boolean => search().copy === 1;
  const theirsRef = (): string | undefined => {
    const number = pull();
    if (number !== undefined) return suggestionRef(number);
    if (!fromCopy()) return undefined;
    const branch = untrack(() => syncWatch.facts(shell.project()?.root)?.reading.branch);
    return branch === undefined ? undefined : copyRef(branch);
  };
  const initialRightId = (): string => {
    const against = untrack(() => search().against);
    if (against === "shared") return "shared";
    return against === "writer" ? "writer" : "disk";
  };
  return { search, pull, fromCopy, theirsRef, initialRightId };
}

export type ReviewRoute = ReturnType<typeof createReviewRoute>;
