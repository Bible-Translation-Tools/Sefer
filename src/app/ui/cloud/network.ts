/**
 * Is this device on a network, and did the last transfer get through?
 *
 * Two detectors, because neither is enough alone. `navigator.onLine` is
 * instant and free but only knows whether an interface is up — a captive
 * portal, a dead proxy and a firewall all report `true`. A transfer that
 * failed with `Network` is the other half: slow to learn, but it is the
 * question actually being asked. v1 carried both for the same reason.
 *
 * Neither is treated as an error. `offline` is the least alarming state in
 * the whole surface: the work is on disk, the button says "Check for
 * changes", and nothing about the screen suggests anything was lost.
 */

import { createSignal, onCleanup, type Accessor } from "solid-js";

import type { RemoteFailureReason } from "../../../core/remote/remote";

export interface NetworkStatus {
  /** `navigator.onLine`, kept live by the window's own events. */
  readonly online: Accessor<boolean>;
  /** Why the last transfer failed, when one did and none has succeeded since. */
  readonly lastFailure: Accessor<RemoteFailureReason | undefined>;
  /** Record a transfer's failure; a `Network` one is what makes us offline. */
  readonly noteFailure: (reason: RemoteFailureReason) => void;
  /** A transfer got through: forget whatever the last one said. */
  readonly noteSuccess: () => void;
}

/**
 * `navigator.onLine` where there is a navigator, and `true` where there is
 * not. Optimism is right for the fallback: a build with no navigator is a
 * test or a server render, and neither should paint an offline banner.
 */
const currentlyOnline = (): boolean => (typeof navigator === "object" ? navigator.onLine : true);

export const createNetworkStatus = (): NetworkStatus => {
  const [online, setOnline] = createSignal(currentlyOnline(), { name: "networkOnline" });
  const [lastFailure, setLastFailure] = createSignal<RemoteFailureReason | undefined>(undefined, {
    name: "lastTransferFailure",
  });

  if (typeof window === "object") {
    const up = (): void => {
      setOnline(true);
      // Coming back up clears a stale network verdict: the next press should
      // be an ordinary attempt, not a retry of something already given up on.
      if (lastFailure() === "Network") setLastFailure(undefined);
    };
    const down = (): void => {
      setOnline(false);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    onCleanup(() => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    });
  }

  return {
    online,
    lastFailure,
    noteFailure: (reason) => setLastFailure(reason),
    noteSuccess: () => setLastFailure(undefined),
  };
};
