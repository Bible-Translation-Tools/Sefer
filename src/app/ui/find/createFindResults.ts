import { createSignal } from "solid-js";

import type * as Search from "#core/search/search";

import type { HelpHit, ReplacePreview } from "./helpers";

export function createFindResults() {
  const [hits, setHits] = createSignal<readonly Search.Hit[]>([], { name: "hits" });
  const [referenceHits, setReferenceHits] = createSignal<readonly Search.ReferenceHit[]>([], {
    name: "referenceHits",
  });
  const [helpHits, setHelpHits] = createSignal<readonly HelpHit[]>([], { name: "helpHits" });
  const [problem, setProblem] = createSignal("", { name: "problem" });
  const [cursor, setCursor] = createSignal(0, { name: "cursor" });
  const [searched, setSearched] = createSignal("", { name: "searched" });
  const [preview, setPreview] = createSignal<ReplacePreview | undefined>(undefined, {
    name: "replacePreview",
  });

  return {
    hits,
    setHits,
    referenceHits,
    setReferenceHits,
    helpHits,
    setHelpHits,
    problem,
    setProblem,
    cursor,
    setCursor,
    searched,
    setSearched,
    preview,
    setPreview,
  };
}

export type FindResults = ReturnType<typeof createFindResults>;
