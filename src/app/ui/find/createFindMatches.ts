import { createMemo } from "solid-js";

import type { Occurrence } from "#core/excerpts/excerpts";

import type { FindExpect } from "./createFindExpect";
import type { FindResults } from "./createFindResults";
import type { FindSources } from "./createFindSources";
import type { Scope } from "./helpers";

export interface MatchesInputs {
  readonly scope: () => Scope;
  readonly results: FindResults;
  readonly sources: FindSources;
  readonly expect: FindExpect;
}

export function createFindMatches(inputs: MatchesInputs) {
  const { scope, results, sources, expect } = inputs;
  const { hits, referenceHits, helpHits } = results;
  const { occurrencesAt } = sources;
  const { expectation, showing } = expect;

  const referenceMatches = createMemo(
    (): readonly Occurrence[] => {
      const wanted = referenceHits();
      if (wanted.length === 0) return [];
      const addresses = wanted.flatMap((hit) => (hit.address === undefined ? [] : [hit.address]));
      if (addresses.length === 0) return [];

      return occurrencesAt(addresses);
    },
    { name: "referenceMatches" },
  );

  const helpMatches = createMemo(
    (): readonly Occurrence[] => {
      const addresses = helpHits().flatMap(({ hit }) => hit.addresses);
      if (addresses.length === 0) return [];
      return occurrencesAt(addresses);
    },
    { name: "helpMatches" },
  );

  const feedHits = createMemo(
    (): readonly Occurrence[] => {
      if (scope() === "helps") return helpMatches();
      if (scope() !== "reference") return hits();
      const split = expectation();
      if (split === undefined) return referenceMatches();
      const shown = showing();
      if (shown === "with") return split.has;
      if (shown === "without") return split.missing;
      return [...split.missing, ...split.has];
    },
    { name: "feedHits" },
  );

  return { feedHits };
}
