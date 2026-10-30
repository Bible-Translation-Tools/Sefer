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
export { type EditorAction } from "./core/commands/actions";
export { type Attribute, type AttributedMarkup } from "./core/attributes";
export {
  attributePopover,
  editorFeatures,
  figures,
  markupChips,
  tables,
  verseMenu,
  type ChipRenderer,
  type EditorFeature,
  type FeatureOptions,
  type FigureSource,
  type FiguresOptions,
} from "./features";
export { type Figure } from "./core/figures";
export { type LineKind } from "./core/commands/poetryLevels";
export type { ExpectedVerses } from "./core/expectedVerses";
export { type UnsupportedMarkup } from "./core/unsupported";
export { PHRASES, type EditorWords, type PhraseKey } from "./core/words";
export { KEY_BUNDLES, type EditorMode, type KeyBundle } from "./core/keymaps";
export { DEFAULT_PREFERENCES, type EditorPreferences } from "./core/preferences";

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
} from "./surfaces/card";
export { mountReader, type ReaderMount } from "./surfaces/reader";
export { mountStamp } from "./surfaces/stamp";
export {
  mountDiffView,
  type DiffHunk,
  type DiffPaint,
  type DiffViewMount,
} from "./surfaces/diffView";
export { mountReference, type ReferenceMount } from "./surfaces/reference";
export { type PairedRange } from "./recipes/pairing";
export { type MarkedRange } from "./surfaces/satellite";

export { createAlignedGroup, revealEditorInBand, type AlignedGroup } from "./surfaces/align";

export { editorPolicy, policyKey, type EditorPolicy, type ProjectionName } from "./views";

export { anchorFrom } from "./core/guards/clip";
export { type ChapterRow } from "./core/model/docStructure";

export { type CorpusAction, type CorpusFinding } from "./recipes/lint";

export { withoutScrolling } from "./core/scroll";

export { annotateRepaint, gestureTrace } from "./observability";
