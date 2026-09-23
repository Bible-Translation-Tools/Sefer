/**
 * Compare: two sources, a decision per difference, one write.
 *
 * The door is here so a screen imports `../../core/compare` and never a file
 * inside it — which is what keeps "a new source is a new file" true, since a
 * new source is then one more line in this barrel and nothing else.
 *
 * See documentation/architecture/review.md.
 */

export { bookComparison, compareBooks, type BookComparison, type CompareResult } from "./compare";
export { applyPlan, type BookPlan, type Plan } from "./decisions";
export { folderSource } from "./folderSource";
export { recordedSource, savedSource, type RecordedTexts } from "./pastSources";
export { currentProjectSource } from "./projectSource";
export { sourceRef, type CompareSource } from "./source";
