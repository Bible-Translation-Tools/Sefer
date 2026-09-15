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

export {
  combine,
  CombineError,
  combineMessage,
  planCombine,
  previewCombine,
  type CombineDecision,
  type CombineOptions,
  type CombineRefusal,
  type CombineReplay,
  type CombineResult,
  type CombineState,
  type CombineSurvey,
} from "./combine";

export { mergeBase, surveyIncoming, type IncomingSurvey, type SurveyOptions } from "./survey";
