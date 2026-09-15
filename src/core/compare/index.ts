/**
 * Compare: two sources, a decision per difference, one write.
 *
 * The door is here so a screen imports `../../core/compare` and never a file
 * inside it — which is what keeps "a new source is a new file" true, since a
 * new source is then one more line in this barrel and nothing else.
 *
 * See documentation/architecture/review.md.
 */

export {
  bookComparison,
  compareBooks,
  wholeBookHunkId,
  type BookComparison,
  type CompareHunk,
  type CompareResult,
  type HunkId,
  type Presence,
} from "./compare";
export {
  allDecisionIds,
  applyPlan,
  type ApplyOptions,
  bookCompleteness,
  completeness,
  decide,
  decideMany,
  decisionFor,
  decisionIds,
  mergedText,
  noDecisions,
  plan,
  type ApplyReport,
  type BookPlan,
  type Completeness,
  type Decision,
  type Decisions,
  type Plan,
} from "./decisions";
export { folderSource } from "./folderSource";
export { recordedSource, savedSource, type RecordedTexts, type SavedText } from "./pastSources";
export { currentProjectSource } from "./projectSource";
export {
  CompareError,
  compareError,
  failCompare,
  sourceRef,
  type CompareSource,
  type CompareSourceKind,
  type SourceRef,
  type SourceText,
} from "./source";
