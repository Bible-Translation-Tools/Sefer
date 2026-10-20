import { createMemo } from "solid-js";

import type { useShell } from "#app/ProjectContext";
import type { Paired } from "#app/ui/excerpts";
import type { BookText, Excerpt } from "#core/excerpts/excerpts";
import { bookHeading } from "#core/galley";
import type * as Search from "#core/search/search";

import type { FindResults } from "./createFindResults";
import type { FindSources } from "./createFindSources";
import { fileName, verseKeys, type HelpHit, type Scope } from "./helpers";

export interface PairingInputs {
  readonly shell: ReturnType<typeof useShell>;
  readonly scope: () => Scope;
  readonly results: FindResults;
  readonly sources: FindSources;
}

function createHelpPairing(inputs: PairingInputs) {
  const { helpHits } = inputs.results;

  const helpReadings = createMemo(
    (): ReadonlyMap<string, HelpHit> => {
      const out = new Map<string, HelpHit>();
      for (const held of helpHits())
        for (const address of held.hit.addresses)
          for (const key of verseKeys(address)) if (!out.has(key)) out.set(key, held);
      return out;
    },
    { name: "helpReadings" },
  );

  return (excerpt: Excerpt): Paired | undefined => {
    const readings = helpReadings();
    for (const key of verseKeys(excerpt.address)) {
      const held = readings.get(key);
      if (held !== undefined)
        return {
          kind: "static",
          name: held.title,
          text: held.text,
          spans: [{ from: held.hit.from, to: held.hit.to }],
        };
    }
    return undefined;
  };
}

function createReferencePairing(inputs: PairingInputs) {
  const { shell, results, sources } = inputs;
  const { referenceHits } = results;
  const { analysisOf } = sources;

  const referenceReadings = createMemo(
    (): ReadonlyMap<string, Search.ReferenceHit> => {
      const out = new Map<string, Search.ReferenceHit>();
      for (const hit of referenceHits()) {
        if (hit.address === undefined) continue;
        for (const key of verseKeys(hit.address)) if (!out.has(key)) out.set(key, hit);
      }
      return out;
    },
    { name: "referenceReadings" },
  );

  const referenceBooks = new Map<string, BookText>();
  const referenceBook = (hit: Search.ReferenceHit): BookText | undefined => {
    const analysis = analysisOf(hit.source);
    const book = hit.address?.book;
    if (analysis === undefined || book === undefined) return undefined;
    const held = referenceBooks.get(hit.source);
    if (held !== undefined && held.analysis === analysis) return held;
    const heading = bookHeading(analysis);
    const made: BookText = {
      bookId: book,
      text: analysis.text,
      analysis,
      label: (address) => shell.location.label(address, heading),
    };
    referenceBooks.set(hit.source, made);
    return made;
  };

  const pairFor = (excerpt: Excerpt): Search.ReferenceHit | undefined => {
    const readings = referenceReadings();
    for (const key of verseKeys(excerpt.address)) {
      const held = readings.get(key);
      if (held !== undefined) return held;
    }
    return undefined;
  };

  return (excerpt: Excerpt): Paired | undefined => {
    const held = pairFor(excerpt);
    if (held === undefined) return undefined;
    const book = referenceBook(held);
    const name = fileName(held.source);
    if (book === undefined) return { kind: "static", name, text: held.preview, spans: [] };
    return {
      kind: "text",
      name,
      book,
      hits: [{ bookId: book.bookId, from: held.from, to: held.to }],
    };
  };
}

export function createFindPairing(inputs: PairingInputs) {
  const { scope, sources } = inputs;
  const { source } = sources;
  const helpPairedOf = createHelpPairing(inputs);
  const pairedOf = createReferencePairing(inputs);

  const feedPairedOf = () => {
    if (scope() === "helps") return helpPairedOf;
    if (!source.shown()) return undefined;
    return scope() === "reference" ? pairedOf : source.pairedOf;
  };

  return { feedPairedOf };
}
