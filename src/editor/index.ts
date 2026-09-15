/**
 * The editor's front door.
 *
 * Everything above this line — composition, the Solid shell, Save, Findings —
 * imports from `src/editor`, and nothing above it imports CodeMirror. The
 * editor imports Galley's `Analysis` and core's `Book`/`Source` vocabulary and
 * nothing else from the app.
 *
 * Grouped the way the seams group it: the engine seam, the assembled editor,
 * the editor-backed Book and its funnel, satellites and windows, views,
 * diagnostics, instruments, and the test harness.
 */

// The engine seam: how a state reaches Galley (see core/analyzer.ts).
export { analyzeCount, analyzed, analyzer, type Analyze } from "./core/analyzer";

// The assembled editor.
export {
  RULE_NAMES,
  commandsLayer,
  enginePort,
  historyLayer,
  install,
  readingLayer,
  rulesLayer,
  usfmEditor,
  usfmEditorHeadless,
  usfmKeys,
  viewLayer,
  type ClipRange,
  type EditorOptions,
  type RuleName,
  type ViewOptions,
} from "./core/compose";
export {
  HOOK,
  PHASES,
  PHASE_ORDER,
  type ParserPort,
  type Phase,
  type PhaseRule,
} from "./core/phases";

// Policy as data: which class paints how, under which projection.
export { PROJECTIONS, assignment, type AssignmentDelta } from "./core/registry";
export {
  modeFacet,
  newlineIsABreak,
  trusted,
  type GetStructure,
  type Mode,
  type PaintPort,
} from "./core/kernel";

// State: structure, plan, paint, decorations, render window.
export {
  PAINT_PORT,
  caretClipAt,
  decoField,
  docText,
  drawsAt,
  isHiddenSpan,
  optsFacet,
  paintAt,
  pickedChapter,
  planAt,
  structureAt,
  structureField,
  type Built,
} from "./core/editorState";
export {
  RENDER_MARGIN,
  renderRangeAt,
  renderRangeField,
  renderWindow,
  setRenderRange,
  widen,
  type RenderRange,
} from "./core/render";
export {
  anchorFrom,
  chapterContaining,
  editableClipAt,
  pickField,
  pullSelectionsIntoTheClip,
  setPick,
  visibleClipAt,
  type Extents,
} from "./core/clip";
export {
  EMPTY_STRUCTURE,
  borrowedStructure,
  isBlankLine,
  isDesignatorLine,
  lineIndexAt,
  opensAParagraph,
  paintsItsOwnLine,
  parseStructure,
  type Block,
  type BlockTable,
  type ChapterRow,
  type DocLine,
  type DocStructure,
  type LineTable,
  type NoteRange,
  type VerseRow,
  type WordRange,
} from "./core/docStructure";

// The editor-backed Book (editor-and-save §1.2) and the port other surfaces
// submit through (§3.5).
export { editorBook, funnelFor, seatFor, type EditorBook, type EditorBookOptions } from "./book";
export { changesOf, fromCanonical, type Funnel, type Receive } from "./funnel";

// Satellites and windows (§3.9).
export { openWindow, type ClipWindow, type WindowOptions } from "./window";
export {
  clippedToScope,
  collapseOutside,
  markedRanges,
  reclip,
  mountSatellite,
  repaintMarks,
  satelliteRange,
  type MarkedRange,
  type Satellite,
  type SatelliteOptions,
} from "./recipes/satellite";

// Views (§3.6).
export { pickChapter, projectionFor, type ProjectionName } from "./views";

// Arriving somewhere: the brief mark that says the jump landed.
export { flash, flashing, type FlashRange } from "./recipes/flash";

// Diagnostics, sink 1 (editor-and-save §2).
export {
  applyFix,
  corpusFindings,
  findings,
  hiddenByPaint,
  setCorpusFindings,
  showCorpusFindings,
  sousField,
  usfmLinter,
  type CorpusFinding,
  type Finding,
  type HiddenTest,
} from "./recipes/lint";

// Clipboard and the attribute popover.
export {
  COPY_PROFILES,
  copyFold,
  copyProfile,
  copyProfileFacet,
  type CopyProfile,
  type EmitRule,
} from "./recipes/copy";
export { alignedWordTooltip, attrSpans, type AttrSpan } from "./recipes/attrs";

// Instruments. `core/instrument.ts` is the one instrument for the pipeline —
// one trace per transaction, the stages in order — and `observabilityTracer`
// is the one bridge into Sefer's ring. `core/timing.ts` is the local span ring
// the keystroke meter attributes time with; `core/trace.ts` is the flat
// per-event adapter over the same instrument.
export { keystrokeMeter, type Measured, type Meter } from "./core/meter";
export { onSpan, recent, span, summary, type TimingSpan } from "./core/timing";
export {
  clearRefusal,
  dumpTrace,
  flushTrace,
  lastRefusal,
  localTracer,
  makeTracer,
  traceFor,
  tracer,
  traces,
  tracing,
  type Emitter,
  type Trace,
  type TraceEmit,
  type TraceEntry,
  type TraceSummary,
  type Tracer,
} from "./core/instrument";
export {
  ringSink,
  sinkTracer,
  traceSink,
  type TraceEvent,
  type TraceSink,
  type TraceStep,
  type Verdict,
} from "./core/trace";
export { observabilityTracer } from "./observability";
export { inspect } from "./core/inspect";
