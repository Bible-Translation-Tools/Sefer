/**
 * The editor's front door: what a host mounts, what it holds, and the words
 * it passes in.
 *
 * A host never touches CodeMirror. It seats a Book (`seatBook`), mounts what
 * it shows — the whole book, a card over a stretch of it, a read-only reader,
 * a diff, a reference — and holds a handle with methods and callbacks
 * (`EditorHandle` and each mount's own). The engine is the host's: it passes
 * an `Analyze` and serves the wasm. Planning item "embeddable editor".
 */

// What a host holds for any mount: methods, never the view.
export {
  type EditorHandle,
  type RevealOptions,
  type RevealScroll,
  type ViewportSource,
} from "./handle";
export { type Where } from "./recipes/whereAmI";

// The editor-backed Book: seated once per book, and the port a satellite
// (or a reader following the book) goes through.
export { type EditorBook } from "./book";
export { seatBook } from "./seat";
export { type Following } from "./funnel";
export { type EditorAction } from "./core/actions";

// Mounts.
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

// Editors shown side by side, aligned by verse.
export { createAlignedGroup, type AlignedGroup } from "./recipes/align";

// How a surface draws and guards its text.
export { editorPolicy, policyKey, type EditorPolicy, type ProjectionName } from "./views";

// The book's chapters, and where one starts.
export { anchorFrom } from "./core/clip";
export { type ChapterRow } from "./core/docStructure";

// The host's own findings, drawn with the engine's.
export { type CorpusFinding } from "./recipes/lint";

// Doing something to the book without moving the page (core/scroll.ts).
export { withoutScrolling } from "./core/scroll";

// Tracing: the open gesture, for a host that records what it caused, and a
// repaint the host provoked.
export { annotateRepaint, gestureTrace } from "./observability";
