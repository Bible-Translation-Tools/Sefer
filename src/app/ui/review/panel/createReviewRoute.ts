import { useSearch } from "@tanstack/solid-router";
import { untrack } from "solid-js";

import type { Shell } from "../../../ProjectContext";
import { copyRef, suggestionRef } from "../../../suggestions";
import { syncWatch } from "../../../syncWatch";

export function createReviewRoute(shell: Shell) {
  // SAFETY: `strict: false` gives the union of every route's search; both fields are read as `unknown` and narrowed, never trusted.
  const search = useSearch({ strict: false }) as () => {
    readonly against?: unknown;
    readonly pull?: unknown;
    readonly copy?: unknown;
  };
  const pull = (): number | undefined => {
    const held = untrack(() => search().pull);
    return typeof held === "number" ? held : undefined;
  };
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
