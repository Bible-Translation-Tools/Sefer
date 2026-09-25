/**
 * The sync module's one door: the pure state machine, the incoming plan, and
 * the one move that writes — Combine.
 *
 * Everything but `./combine.ts` and `./survey.ts` is pure; those two are
 * Effect programs over the Git, Remote and FileSystem ports and nothing else.
 * See documentation/architecture/sync.md for the states, the two clocks, and
 * why scripture text is never merged automatically.
 */

export {
  emptyReading,
  notIn,
  sync,
  trackingRef,
  wantsPlan,
  type Clock,
  type Sync,
  type SyncActionId,
  type SyncReading,
  type SyncState,
} from "./state";

export { FRONT_MATTER, emptyPlan, type IncomingBook, type IncomingPlan } from "./plan";

export {
  combine,
  CombineError,
  combineMessage,
  previewCombine,
  type CombineRefusal,
  type CombineReplay,
  type CombineState,
} from "./combine";

export { mergeBase, surveyIncoming } from "./survey";
