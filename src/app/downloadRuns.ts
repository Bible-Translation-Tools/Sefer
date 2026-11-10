import { createSignal } from "solid-js";

import {
  idleDownload,
  stepDownload,
  type DownloadEvent,
  type DownloadPhase,
} from "#core/remote/download";

import { describe } from "./describe";

/** How long a download can still be called off before anything is asked of the network. */
export const DOWNLOAD_WINDOW_MS = 2000;

// The plain map is the truth and the signal draws it: Solid 2 batches writes, so a guard that
// read the signal in the same instant would see the old phase.
const phases = new Map<string, DownloadPhase>();
const [drawn, setDrawn] = createSignal<ReadonlyMap<string, DownloadPhase>>(new Map(), {
  name: "downloadPhases",
});
const windows = new Map<string, ReturnType<typeof setTimeout>>();

const send = (key: string, event: DownloadEvent): DownloadPhase => {
  const next = stepDownload(phases.get(key) ?? idleDownload, event);
  if (next.kind === "idle") phases.delete(key);
  else phases.set(key, next);
  setDrawn(new Map(phases));
  return next;
};

/**
 * Every download's phase (`src/core/remote/download.ts`), by the key its surface gives it.
 * Held here and not in a screen, so a download asked for on one screen is the same download
 * on another, and leaving a screen does not lose it.
 */
export const downloadRuns = {
  /** For drawing: tracked. */
  of: (key: string): DownloadPhase => drawn().get(key) ?? idleDownload,
  /** For drawing a list: whether this download is waiting or under way. */
  busy: (key: string): boolean => {
    const kind = downloadRuns.of(key).kind;
    return kind === "pending" || kind === "fetching";
  },
  /**
   * Ask for a download. It waits out the window, then `run` does the work and its promise
   * decides `done` or `failed`. A second ask while one is waiting or under way is ignored.
   * `wait: 0` is for a surface with nowhere to put Cancel: the window is skipped.
   */
  ask: (key: string, run: () => Promise<unknown>, wait = DOWNLOAD_WINDOW_MS): void => {
    if (send(key, { kind: "ask" }).kind !== "pending" || windows.has(key)) return;
    const begin = (): void => {
      windows.delete(key);
      if (send(key, { kind: "elapsed" }).kind !== "fetching") return;
      void run().then(
        () => send(key, { kind: "arrived" }),
        (cause: unknown) => send(key, { kind: "failed", why: describe(cause) }),
      );
    };
    if (wait === 0) begin();
    else windows.set(key, setTimeout(begin, wait));
  },
  /** Call it off. Only inside the window; after it this does nothing. */
  cancel: (key: string): void => {
    if (send(key, { kind: "cancel" }).kind !== "idle") return;
    clearTimeout(windows.get(key));
    windows.delete(key);
  },
  dismiss: (key: string): void => void send(key, { kind: "dismiss" }),
};
