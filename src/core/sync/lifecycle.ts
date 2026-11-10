/**
 * What a project is doing with its shared copy right now, as one machine:
 * checking, receiving, working out where a send goes, sending, or settling
 * incoming work at a save. One per project. `syncStateOf` (`state.ts`) stays
 * the classifier of where the project stands; this is the process, and the
 * classifier reads `checking` and `refused` from it.
 *
 * A send asked for during a check waits for it (one send; a second is the
 * same send). Nothing else overlaps: a check is not started over a send.
 */
import type { RemoteFailureReason } from "../remote/remote";

export interface SyncPhase {
  readonly kind: "idle" | "checking" | "receiving" | "routing" | "sending" | "settling";
  /** A send is waiting for the check or the receive to end. */
  readonly queued: boolean;
  /** Why the last send was refused; cleared by a send that arrives. */
  readonly refused: RemoteFailureReason | undefined;
}

export const idleSync: SyncPhase = { kind: "idle", queued: false, refused: undefined };

export type SyncEvent =
  | { readonly kind: "check" }
  /** The check ended, with or without an answer, and nothing is brought in by itself. */
  | { readonly kind: "checked" }
  /** The check brought history down and "skip review of incoming" receives it now. */
  | { readonly kind: "fetched" }
  | { readonly kind: "received" }
  | { readonly kind: "send" }
  /** Where the send goes is known: the shared project, or the person's own copy. */
  | { readonly kind: "routed" }
  | { readonly kind: "sent" }
  /** Nothing is linked, so nothing was sent. */
  | { readonly kind: "detached" }
  /** `reason` undefined: refused without a transfer failure (no right to write). */
  | { readonly kind: "refused"; readonly reason: RemoteFailureReason | undefined }
  /** The shared project has work this device lacks: a check follows. */
  | { readonly kind: "rejected" }
  | { readonly kind: "settle" }
  | { readonly kind: "settled" };

type Kind = SyncPhase["kind"];
type Transitions = Record<Kind, Partial<Record<SyncEvent["kind"], Kind | readonly [Kind, Kind]>>>;

/** Two targets: the first when no send is waiting, the second when one is. */
export const syncTransitions = {
  idle: { check: "checking", send: "routing", settle: "settling" },
  checking: { send: "checking", checked: ["idle", "routing"], fetched: "receiving" },
  receiving: { send: "receiving", received: ["idle", "routing"] },
  routing: { routed: "sending", refused: "idle", rejected: "checking" },
  sending: { sent: "idle", detached: "idle", refused: "idle", rejected: "checking" },
  settling: { settled: "idle" },
} as const satisfies Transitions;

/** The phase after an event. An event the phase has no way out for leaves it as it was. */
export const stepSync = (phase: SyncPhase, event: SyncEvent): SyncPhase => {
  const ways: Transitions[Kind] = syncTransitions[phase.kind];
  const way = ways[event.kind];
  if (way === undefined) return phase;
  const [plain, withQueued] = typeof way === "string" ? [way, way] : way;
  const kind = phase.queued ? withQueued : plain;
  switch (event.kind) {
    case "send":
      return { ...phase, kind, queued: phase.kind !== "idle" };
    case "checked":
    case "received":
      return { ...phase, kind, queued: false };
    case "sent":
      return { ...phase, kind, refused: undefined };
    case "refused":
      return { ...phase, kind, refused: event.reason ?? phase.refused };
    case "rejected":
      return { ...phase, kind, refused: "Rejected" };
    case "check":
    case "fetched":
    case "routed":
    case "detached":
    case "settle":
    case "settled":
      return { ...phase, kind };
  }
};
