import { createSignal } from "solid-js";

import { idleSync, stepSync, type SyncEvent, type SyncPhase } from "#core/sync/lifecycle";

// The plain map is the truth and the signal draws it: Solid 2 batches writes, so a guard that
// read the signal in the same instant would see the old phase.
const phases = new Map<string, SyncPhase>();
const [drawn, setDrawn] = createSignal<ReadonlyMap<string, SyncPhase>>(new Map(), {
  name: "syncPhases",
});
const idlers = new Map<string, (() => void)[]>();

/** Each project's sync phase (`src/core/sync/lifecycle.ts`): `syncActions.ts` sends, everything else reads. */
export const syncPhase = {
  /** For a guard: the phase this instant. */
  now: (root: string): SyncPhase => phases.get(root) ?? idleSync,
  /** For drawing and for readings: tracked. */
  of: (root: string | undefined): SyncPhase =>
    (root === undefined ? undefined : drawn().get(root)) ?? idleSync,
  send: (root: string, event: SyncEvent): SyncPhase => {
    const next = stepSync(syncPhase.now(root), event);
    phases.set(root, next);
    setDrawn(new Map(phases));
    if (next.kind === "idle") for (const wake of idlers.get(root)?.splice(0) ?? []) wake();
    return next;
  },
  /** Resolves once nothing is running for this project; at once when nothing is. */
  whenIdle: (root: string): Promise<void> =>
    syncPhase.now(root).kind === "idle"
      ? Promise.resolve()
      : new Promise((resolve) => {
          idlers.set(root, [...(idlers.get(root) ?? []), resolve]);
        }),
};
