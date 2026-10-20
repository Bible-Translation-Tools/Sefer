import { createMemo, createSignal } from "solid-js";

import type { useShell } from "#app/ProjectContext";
import { readBooks } from "#app/ui/excerpts";
import { expectIn, expectedPattern } from "#core/search/expect";

import type { FindResults } from "./createFindResults";
import type { createFindSources } from "./createFindSources";
import type { Expected, FindSearch, Scope } from "./helpers";

export interface ExpectInputs {
  readonly shell: ReturnType<typeof useShell>;
  readonly params: () => FindSearch;
  readonly scope: () => Scope;
  readonly results: FindResults;
  readonly sources: ReturnType<typeof createFindSources>;
  readonly ask: (next: FindSearch) => void;
}

export function createFindExpect(inputs: ExpectInputs) {
  const { shell, params, scope, ask } = inputs;
  const { referenceHits } = inputs.results;
  const { analyze } = inputs.sources;

  const expected = createMemo(() => params().expect ?? "", { name: "findExpect" });
  const expectation = createMemo(
    () => {
      if (scope() !== "reference") return undefined;
      const pattern = expectedPattern(expected());
      if (pattern === undefined) return undefined;
      const addresses = referenceHits().flatMap((hit) =>
        hit.address === undefined ? [] : [hit.address],
      );
      const books = readBooks(shell, new Set(addresses.map((address) => address.book)), analyze);
      const split = books.map((book) => expectIn(book, addresses, pattern));
      return {
        has: split.flatMap((book) => book.has),
        missing: split.flatMap((book) => book.missing),
      };
    },
    { name: "expectation" },
  );
  const showing = (): Expected => params().show ?? "without";
  const [expecting, setExpecting] = createSignal(false, { name: "findExpecting" });
  const expectShown = (): boolean => expecting() || params().expect !== undefined;
  const toggleExpect = (on: boolean): void => {
    setExpecting(on);
    if (!on) ask({ expect: undefined, show: undefined });
  };

  return { expectation, showing, expectShown, toggleExpect };
}

export type FindExpect = ReturnType<typeof createFindExpect>;
