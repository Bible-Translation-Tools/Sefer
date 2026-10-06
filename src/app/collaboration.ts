/**
 * How this person works on the open project with other people, as ONE answer
 * for every surface: the app bar's cloud popover, Settings' Cloud section,
 * and the Suggestions list.
 *
 * Kept apart from `syncWatch` because the two are asked different things:
 * a sync reading is local (refs already here), and these facts are the
 * network's — whether this account can write to the shared project, the
 * person's newest suggestion, how many wait for an editor. They are asked on
 * the check's schedule (`checkForChanges`), after a send the shared project
 * refused, and after the mode changes; nowhere else.
 *
 * Whether someone can write is the network's answer and never a remembered
 * one: it is asked again every time, and a refused send outranks it.
 */

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
  /** Can the signed-in account write to the shared project? `undefined`: not known. */
  readonly canWrite: boolean | undefined;
  /** The person's newest suggestion, in the copy mode. */
  readonly mine: MySuggestion | undefined;
  /** Suggestions waiting for an editor, for someone who can write. */
  readonly waiting: number;
  /** The copy has work this device lacks — sent from another of the person's devices. */
  readonly copyAhead: boolean;
  /** This device has work the shared project lacks: what an offer would carry. */
  readonly offerable: boolean;
  /** Where a send goes, `owner/name`: the shared project, or the person's copy. */
  readonly sendsTo: string | undefined;
}

const [held, setHeld] = createSignal<
  { readonly root: string; readonly facts: CollabFacts } | undefined
>(undefined, { name: "collaborationFacts" });

/** Only the newest ask publishes, as in `syncWatch`. */
let asked = 0;

export const collaboration = {
  /** The facts for the project at `root`, or `undefined` before the first ask. */
  facts: (root: string | undefined): CollabFacts | undefined => {
    const found = held();
    return root !== undefined && found?.root === root ? found.facts : undefined;
  },
  /** Ask the network again and publish; never throws. */
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
      },
    });
  },
};
