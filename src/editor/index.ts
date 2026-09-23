/**
 * The editor's front door.
 *
 * Everything above this line — composition, the Solid shell, Save, Findings —
 * imports from `src/editor`, and nothing above it imports CodeMirror. The
 * editor imports Galley's `Analysis` and core's `Book`/`Source` vocabulary and
 * nothing else from the app.
 *
 * Grouped by seam: the engine seam, the assembled editor,
 * the editor-backed Book and its funnel, satellites and windows, views,
 * diagnostics, instruments, and the test harness.
 */

// The engine seam: how a state reaches Galley (see core/analyzer.ts).
export { analyzer } from "./core/analyzer";

// The assembled editor.
export { commandsLayer, readingLayer, viewLayer } from "./core/compose";

// Structured entry: the named insert gestures, and the front matter card.
export { type EditorAction } from "./core/actions";
export { frontMatterCard } from "./core/frontmatter";

// Policy as data: which class paints how, under which projection.
export { assignment } from "./core/registry";
export { modeFacet } from "./core/kernel";

// State: structure, plan, paint, decorations, render window.
export { structureAt } from "./core/editorState";
export { anchorFrom } from "./core/clip";
export { type ChapterRow } from "./core/docStructure";

// The editor-backed Book and the port other surfaces submit through.
export { editorBook, type EditorBook } from "./book";

// Satellites and windows.
export {
  clippedToScope,
  markedRanges,
  reclip,
  mountSatellite,
  type Satellite,
} from "./recipes/satellite";

// Doing something to the book without moving the page (core/scroll.ts).
export { withoutScrolling } from "./core/scroll";

// Blocks a translator still has to fill: the ghost, and the set behind it.
export {
  annotateEmptyBlocks,
  blockNamer,
  emptyBlocks,
  showEmptyBlocks,
} from "./recipes/emptyBlocks";

// Views.
export { pickChapter, projectionFor, type ProjectionName } from "./views";

// The read-only reference pane: another resource's book, same projection.
export { mountReference, type ReferenceMount } from "./recipes/reference";
export { pairingHere, showBlockPairs, type PairedRange } from "./recipes/pairing";

// Arriving somewhere: the brief mark that says the jump landed.
export { flash, flashing } from "./recipes/flash";

// Diagnostics, sink 1.
export { showCorpusFindings, usfmLinter, type CorpusFinding } from "./recipes/lint";
export { lintHoverGrace } from "./recipes/lintHover";
export { watchLocation } from "./recipes/whereAmI";
export { noteBookIs, noteEditing } from "./recipes/noteEditor";

// Clipboard and the attribute popover.

// Instruments. `core/instrument.ts` is the one instrument for the pipeline —
// one trace per transaction, the stages in order — and `observabilityTracer`
// is the one bridge into Sefer's ring. `core/timing.ts` is the local span ring
// the keystroke meter attributes time with; `core/trace.ts` is the flat
// per-event adapter over the same instrument.
export { keystrokeMeter } from "./core/meter";
export { annotateRepaint, gestureTrace } from "./observability";
export { annotateOpen } from "./core/instrument";
