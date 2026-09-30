/**
 * Is this device on a network, is a check running, and did the last send get
 * through? One answer for the whole application, not one per screen.
 *
 * The check on open, send on save, the Save dialog's last line and `/cloud`
 * all ask the same questions, and a signal each screen made for itself would
 * let them disagree: `/cloud` showing "offline" while a save goes on trying to
 * send. So these live for the application's lifetime, at module level, the way
 * `projectNames.ts` does.
 *
 * Online is read twice, because neither detector is enough alone.
 * `navigator.onLine` is instant and free but only knows whether an interface is
 * up — a captive portal, a dead proxy and a firewall all report `true`. A
 * transfer that failed with `Network` is the other half: slow to learn, but it
 * is the question actually being asked. It is not a media query: CSS has no
 * connectivity feature, and the window's `online`/`offline` pair is the event.
 *
 * None of this is an error. `offline` is the least alarming state on the
 * surface: the work is on disk, and nothing suggests anything was lost.
 */

import { createSignal, type Accessor } from "solid-js";

import type { RemoteFailureReason } from "#core/remote/remote";

/**
 * `navigator.onLine` where there is a navigator, and `true` where there is
 * not. Optimism is right for the fallback: a build with no navigator is a
 * test or a server render, and neither should paint an offline banner.
 */
const currentlyOnline = (): boolean => (typeof navigator === "object" ? navigator.onLine : true);

const [online, setOnline] = createSignal(currentlyOnline(), { name: "networkOnline" });
const [lastFailure, setLastFailure] = createSignal<RemoteFailureReason | undefined>(undefined, {
  name: "lastTransferFailure",
});
const [checking, setChecking] = createSignal<ReadonlySet<string>>(new Set(), {
  name: "syncChecking",
});
const [sendRefused, setSendRefused] = createSignal(false, { name: "sendRefused" });

if (typeof window === "object") {
  window.addEventListener("online", () => {
    setOnline(true);
    // Coming back up clears a stale network verdict: the next attempt should
    // be an ordinary one, not a retry of something already given up on.
    if (lastFailure() === "Network") setLastFailure(undefined);
  });
  window.addEventListener("offline", () => setOnline(false));
}

export interface SyncStatus {
  /** Online by both detectors: the interface is up and no transfer said otherwise. */
  readonly online: Accessor<boolean>;
  /**
   * Whether an interface is up at all, ignoring how the last transfer ended.
   * The automatic check and send ask this, not `online`: they ARE the probe
   * that finds out whether a network failure is over, and a signal that
   * waited for a success before trying would never see one.
   */
  readonly interfaceUp: Accessor<boolean>;
  /** Why the last transfer failed, when one did and none has succeeded since. */
  readonly lastFailure: Accessor<RemoteFailureReason | undefined>;
  /** Record a transfer's failure; a `Network` one is what makes us offline. */
  readonly noteFailure: (reason: RemoteFailureReason) => void;
  /** A transfer got through: forget whatever the last one said. */
  readonly noteSuccess: () => void;
  /** Whether a check on the project at `root` is running now. */
  readonly checking: (root: string | undefined) => boolean;
  /** Marks a check on `root` as running, or finished. */
  readonly setChecking: (root: string, running: boolean) => void;
  /** Whether the last send was refused; `lastFailure` says why. */
  readonly sendRefused: Accessor<boolean>;
  /** Record how a send ended. */
  readonly noteSend: (
    outcome: { readonly sent: true } | { readonly refused: RemoteFailureReason },
  ) => void;
}

export const syncStatus: SyncStatus = {
  online: () => online() && lastFailure() !== "Network",
  interfaceUp: online,
  lastFailure,
  noteFailure: (reason) => setLastFailure(reason),
  noteSuccess: () => setLastFailure(undefined),
  checking: (root) => root !== undefined && checking().has(root),
  setChecking: (root, running) =>
    setChecking((held) => {
      const next = new Set(held);
      if (running) next.add(root);
      else next.delete(root);
      return next;
    }),
  sendRefused,
  noteSend: (outcome) => {
    if ("sent" in outcome) {
      setSendRefused(false);
      setLastFailure(undefined);
    } else {
      setSendRefused(true);
      setLastFailure(outcome.refused);
    }
  },
};
