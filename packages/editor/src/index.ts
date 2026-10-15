/**
 * The editor's front door.
 *
 * Everything above this line — composition, the Solid shell, Save, Findings —
 * imports from `src/editor`, and nothing above it imports CodeMirror. The
 * editor imports Galley's `Analysis` and core's `Book`/`Source` vocabulary and
 * nothing else from the app.
 *
 * Grouped by seam: the engine seam, the assembled editor,
 * the editor-backed Book and its funnel, satellites, views,
 * diagnostics, instruments, and the test harness.
 */

// Structured entry: the named insert gestures, and the front matter card.
export { type EditorAction } from "./core/actions";
export { frontMatterCard } from "./core/frontmatter";

// State: structure, plan, paint, decorations, render window.
export { structureAt } from "./core/editorState";
export { anchorFrom } from "./core/clip";
export { type ChapterRow } from "./core/docStructure";

// The editor-backed Book and the port other surfaces submit through.
export { type EditorBook } from "./book";
export { seatBook } from "./seat";
export { type Funnel } from "./funnel";

// A card's editor over a stretch of the book, and the read-only reader an
// excerpt shows until it is edited.
export { type MarkedRange } from "./recipes/satellite";
export { mountReader, type ReaderMount } from "./recipes/reader";
export {
  mountCard,
  type CardCaret,
  type CardMount,
  type CardOptions,
  type CardSession,
} from "./recipes/card";

// What a host holds for any mount: methods, never the view.
export { handleOfView, type EditorHandle, type RevealOptions, type RevealScroll } from "./handle";
export { type Where } from "./recipes/whereAmI";
export { mountStamp } from "./recipes/stamp";
export {
  mountDiffView,
  type DiffHunk,
  type DiffPaint,
  type DiffViewMount,
} from "./recipes/diffView";

// Doing something to the book without moving the page (core/scroll.ts).
export { withoutScrolling } from "./core/scroll";

// Blocks a translator still has to fill: the ghost, and the set behind it.
export {
  annotateEmptyBlocks,
  blockNamer,
  emptyBlocks,
  showEmptyBlocks,
} from "./recipes/emptyBlocks";

// Views: a projection on a surface (`modeView`), and the chapter clip.
export {
  editorPolicy,
  modeView,
  pickChapter,
  policyKey,
  type EditorPolicy,
  type ProjectionName,
} from "./views";

// The read-only reference pane: another resource's book, same projection.
export { mountReference, type ReferenceMount } from "./recipes/reference";
export { pairingHere, showBlockPairs, type PairedRange } from "./recipes/pairing";

// Arriving somewhere: the brief mark that says the jump landed.
export { flash, flashing } from "./recipes/flash";

// Diagnostics, sink 1.
export { showCorpusFindings, type CorpusFinding } from "./recipes/lint";
export { watchLocation } from "./recipes/whereAmI";
export { createAlignedGroup, type AlignedGroup } from "./recipes/align";
export { noteBookIs } from "./recipes/noteEditor";

// Clipboard and the attribute popover.

// Instruments. `core/instrument.ts` is the one instrument for the pipeline —
// one trace per transaction, the stages in order — and `observabilityTracer`
// is the one bridge into Sefer's ring. `core/timing.ts` is the local span ring
// the keystroke meter attributes time with; `core/trace.ts` is the flat
// per-event adapter over the same instrument.
export { keystrokeMeter } from "./core/meter";
export { span } from "./core/timing";
export { annotateRepaint, gestureTrace } from "./observability";
export { annotateOpen } from "./core/instrument";
