import { createSignal, type Accessor } from "solid-js";

import type { RemoteFailureReason } from "#core/remote/remote";

const currentlyOnline = (): boolean => (typeof navigator === "object" ? navigator.onLine : true);

const [online, setOnline] = createSignal(currentlyOnline(), { name: "networkOnline" });
const [lastFailure, setLastFailure] = createSignal<RemoteFailureReason | undefined>(undefined, {
  name: "lastTransferFailure",
});
// The person's own "work offline": the gate in `network.ts` reads it, and nothing reaches the
// network while it is on. On until the stored choice is read at start (`services.ts`).
const [workOffline, setWorkOffline] = createSignal(true, {
  name: "workOffline",
  ownedWrite: true,
});

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
}

export const syncStatus: SyncStatus = {
  online: () => online() && !workOffline() && lastFailure() !== "Network",
  interfaceUp: () => online() && !workOffline(),
  workOffline,
  setWorkOffline: (offline) => setWorkOffline(offline),
  lastFailure,
  noteFailure: (reason) => setLastFailure(reason),
  noteSuccess: () => setLastFailure(undefined),
};
