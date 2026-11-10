import { createSignal, type Accessor } from "solid-js";

import type { RemoteFailureReason } from "#core/remote/remote";

const currentlyOnline = (): boolean => (typeof navigator === "object" ? navigator.onLine : true);

const [online, setOnline] = createSignal(currentlyOnline(), { name: "networkOnline" });
const [lastFailure, setLastFailure] = createSignal<RemoteFailureReason | undefined>(undefined, {
  name: "lastTransferFailure",
});
const [checking, setChecking] = createSignal<ReadonlySet<string>>(new Set(), {
  name: "syncChecking",
});
// The person's own "work offline". Today it stops sync only (check, send, the survey, History's
// deepen); the catalogue, sign-in, cloning and the update check still reach the network.
const [workOffline, setWorkOffline] = createSignal(false, {
  name: "workOffline",
  ownedWrite: true,
});
const [sendRefused, setSendRefused] = createSignal(false, { name: "sendRefused" });

if (typeof window === "object") {
  window.addEventListener("online", () => {
    setOnline(true);
    if (lastFailure() === "Network") setLastFailure(undefined);
  });
  window.addEventListener("offline", () => setOnline(false));
}

export interface SyncStatus {
  readonly online: Accessor<boolean>;
  readonly interfaceUp: Accessor<boolean>;
  /** Whether the person chose to work offline (the app bar's Online / Offline switch). */
  readonly workOffline: Accessor<boolean>;
  readonly setWorkOffline: (offline: boolean) => void;
  readonly lastFailure: Accessor<RemoteFailureReason | undefined>;
  readonly noteFailure: (reason: RemoteFailureReason) => void;
  readonly noteSuccess: () => void;
  readonly checking: (root: string | undefined) => boolean;
  readonly setChecking: (root: string, running: boolean) => void;
  readonly sendRefused: Accessor<boolean>;
  readonly noteSend: (
    outcome: { readonly sent: true } | { readonly refused: RemoteFailureReason },
  ) => void;
}

export const syncStatus: SyncStatus = {
  online: () => online() && !workOffline() && lastFailure() !== "Network",
  interfaceUp: () => online() && !workOffline(),
  workOffline,
  setWorkOffline: (offline) => setWorkOffline(offline),
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
