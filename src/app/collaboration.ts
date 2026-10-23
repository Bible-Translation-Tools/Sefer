import { createSignal } from "solid-js";

import type { Project } from "#core/project/project";

import type { Services } from "./services";
import {
  aheadOfShared,
  canWriteShared,
  copyHasMore,
  modeOf,
  mySuggestion,
  openSuggestions,
  sendingToName,
  type MySuggestion,
} from "./suggestions";
import type { CollabMode } from "./syncSettings";

interface CollabFacts {
  readonly mode: CollabMode;
  readonly canWrite: boolean | undefined;
  readonly mine: MySuggestion | undefined;
  readonly waiting: number;
  readonly copyAhead: boolean;
  readonly offerable: boolean;
  readonly sendsTo: string | undefined;
  readonly checkedAt: number;
}

const [held, setHeld] = createSignal<
  { readonly root: string; readonly facts: CollabFacts } | undefined
>(undefined, { name: "collaborationFacts" });

let asked = 0;

export const collaboration = {
  facts: (root: string | undefined): CollabFacts | undefined => {
    const found = held();
    return root !== undefined && found?.root === root ? found.facts : undefined;
  },
  refresh: async (services: Services, project: Project): Promise<void> => {
    const mine = ++asked;
    const mode = await modeOf(services, project);
    const canWrite = await canWriteShared(services, project);
    const [latest, waiting, copyAhead, offerable, sendsTo] = await Promise.all([
      mode === "copy" ? mySuggestion(services, project) : Promise.resolve(undefined),
      canWrite === true ? openSuggestions(services, project) : Promise.resolve([]),
      mode === "copy" ? copyHasMore(services, project) : Promise.resolve(false),
      mode === "copy" ? aheadOfShared(services, project) : Promise.resolve(false),
      sendingToName(services, project),
    ]);
    if (mine !== asked) return;
    setHeld({
      root: project.root,
      facts: {
        mode,
        canWrite,
        mine: latest,
        waiting: waiting.length,
        copyAhead,
        offerable,
        sendsTo,
        checkedAt: Date.now(),
      },
    });
  },
};
