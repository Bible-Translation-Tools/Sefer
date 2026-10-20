import type { Address } from "@sefer/text/location/address";
import { Exit, Option } from "effect";
import { createEffect, createSignal, untrack } from "solid-js";

import type { useShell } from "#app/ProjectContext";
import { readBooks } from "#app/ui/excerpts";
import { createFindSource } from "#app/ui/search/findSource";
import * as Workflows from "#app/workflows/references";
import { refOccurrences, type Occurrence } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";

import type { Scope, Searchable } from "./helpers";

export interface SourcesInputs {
  readonly shell: ReturnType<typeof useShell>;
  readonly scope: () => Scope;
  readonly rerunHelps: () => void;
}

type Shell = ReturnType<typeof useShell>;

function createAnalysisOf(shell: Shell) {
  const referenceParses = new Map<string, Analysis>();
  return (id: string): Analysis | undefined => {
    const held = Option.getOrUndefined(shell.services.projectAnalysis.analysis(id));
    if (held !== undefined) return held.analysis;
    const text = shell.services.projectAnalysis.referenceText(id);
    if (text === undefined) return undefined;
    const parsed = referenceParses.get(id);
    if (parsed !== undefined && parsed.text === text) return parsed;
    const fresh = shell.services.galley.analyze(text, "find.reference");
    referenceParses.set(id, fresh);
    return fresh;
  };
}

function createSearchable(
  shell: Shell,
  scope: () => Scope,
  rerunHelps: () => void,
  rebound: () => number,
) {
  const [searchable, setSearchable] = createSignal<readonly Searchable[]>([], {
    name: "findSearchable",
  });
  createEffect(
    () => ({ root: shell.project()?.root, tick: rebound() }),
    ({ root }) => {
      if (root === undefined) {
        setSearchable([]);
        return;
      }
      void shell.services
        .run(shell.services.library.picked(root))
        .then(async (picks) => {
          const found: Searchable[] = [];
          const seen = new Set<string>();
          for (const { resource } of picks) {
            if (seen.has(resource.id)) continue;
            seen.add(resource.id);
            const exit = await shell.resources.open(resource);
            if (Exit.isSuccess(exit) && exit.value.handle.documents !== undefined)
              found.push({ resource, documents: exit.value.handle.documents });
          }
          return found;
        })
        .then(setSearchable);
    },
  );
  createEffect(
    () => searchable(),
    (now) => {
      if (now.length > 0 && untrack(scope) === "helps") void untrack(() => rerunHelps());
    },
  );
  return searchable;
}

export function createFindSources(inputs: SourcesInputs) {
  const { shell, scope, rerunHelps } = inputs;
  const analyze = shell.services.galley.memoize();

  const analysisOf = createAnalysisOf(shell);

  const occurrencesAt = (addresses: readonly Address[]): readonly Occurrence[] => {
    const books = readBooks(shell, new Set(addresses.map((address) => address.book)), analyze);
    return books.flatMap((book) => refOccurrences(book, addresses));
  };

  const [bound, setBound] = createSignal(Workflows.EMPTY, { name: "boundReferences" });
  const [rebound, setRebound] = createSignal(0, { name: "findRebound" });
  const source = createFindSource(() => setRebound((held) => held + 1));

  createEffect(
    () => ({ id: shell.project()?.root, tick: rebound() }),
    ({ id }) => {
      if (id === undefined) {
        setBound(Workflows.EMPTY);
        return;
      }
      void shell.services.run(Workflows.bindReferences(id)).then(setBound);
    },
  );

  const hasReference = (): boolean => bound().ids.length > 0;

  const searchable = createSearchable(shell, scope, rerunHelps, rebound);
  const helpsTitle = (): string =>
    searchable()
      .map((each) => each.resource.title)
      .join(", ");

  return {
    analyze,
    analysisOf,
    occurrencesAt,
    bound,
    source,
    hasReference,
    searchable,
    helpsTitle,
  };
}

export type FindSources = ReturnType<typeof createFindSources>;
