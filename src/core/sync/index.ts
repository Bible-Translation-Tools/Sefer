/**
 * The sync module's one door: the pure state machine and the incoming plan.
 *
 * Nothing in here does IO. See documentation/architecture/sync.md for the
 * states, the two clocks, and why scripture text is never merged automatically.
 */

export {
  clocksOf,
  emptyReading,
  notIn,
  primaryActionOf,
  sync,
  syncStateOf,
  trackingRef,
  wantsPlan,
  type Clock,
  type Clocks,
  type Sync,
  type SyncActionId,
  type SyncReading,
  type SyncState,
} from "./state";

export {
  FRONT_MATTER,
  chapterSlices,
  chaptersChanged,
  combinePlan,
  emptyPlan,
  incomingPlan,
  type CombinePlan,
  type IncomingBook,
  type IncomingFile,
  type IncomingPlan,
} from "./plan";
