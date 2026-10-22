export {
  type EditorHandle,
  type RevealOptions,
  type RevealScroll,
  type ViewportSource,
} from "./handle";
export { type Where } from "./recipes/whereAmI";

export { type EditorBook } from "./book";
export { seatBook } from "./seat";
export { type Following } from "./funnel";
export { type EditorAction } from "./core/actions";
export { type Attribute, type AttributedMarkup } from "./core/attributes";
export {
  attributePopover,
  editorFeatures,
  figures,
  markupChips,
  verseMenu,
  type ChipRenderer,
  type EditorFeature,
  type FeatureOptions,
  type FigureSource,
  type FiguresOptions,
} from "./features";
export { type Figure } from "./core/figures";
export { type UnsupportedMarkup } from "./core/unsupported";
export { PHRASES, type EditorWords, type PhraseKey } from "./core/words";

export {
  mountBookEditor,
  type BookEditorMount,
  type BookEditorOptions,
  type DrawnDiagnostic,
  type RememberedPlace,
} from "./bookEditor";
export {
  mountCard,
  type CardCaret,
  type CardMount,
  type CardOptions,
  type CardSession,
} from "./recipes/card";
export { mountReader, type ReaderMount } from "./recipes/reader";
export { mountStamp } from "./recipes/stamp";
export {
  mountDiffView,
  type DiffHunk,
  type DiffPaint,
  type DiffViewMount,
} from "./recipes/diffView";
export { mountReference, type ReferenceMount } from "./recipes/reference";
export { type PairedRange } from "./recipes/pairing";
export { type MarkedRange } from "./recipes/satellite";

export { createAlignedGroup, type AlignedGroup } from "./recipes/align";

export { editorPolicy, policyKey, type EditorPolicy, type ProjectionName } from "./views";

export { anchorFrom } from "./core/clip";
export { type ChapterRow } from "./core/docStructure";

export { type CorpusAction, type CorpusFinding } from "./recipes/lint";

export { withoutScrolling } from "./core/scroll";

export { annotateRepaint, gestureTrace } from "./observability";
