/**
 * The sync module's one door: the pure state machine, the incoming plan, and
 * the two moves that write — Receive and Combine.
 *
 * Everything but `./combine.ts`, `./receive.ts` and `./survey.ts` is pure;
 * those are Effect programs over the ports and nothing else.
 * See documentation/architecture/sync.md for the states, the two clocks, and
 * why scripture text is never merged automatically.
 */

export {
  emptyReading,
  notIn,
  sync,
  trackingRef,
  type Clock,
  type Sync,
  type SyncReading,
  type SyncState,
} from "./state";

export { FRONT_MATTER, emptyPlan, type IncomingBook, type IncomingPlan } from "./plan";

export { combine, type CombineRefusal, type CombineState } from "./combine";

export { mergeBase, surveyIncoming } from "./survey";

export { receive, type ReceiveRefusal } from "./receive";
