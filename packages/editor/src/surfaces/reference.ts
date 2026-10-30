import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { readingLayer, viewLayer } from "../core/compose";
import { hiddenFrontMatter } from "../core/frontmatter";
import { anchorFrom } from "../core/guards/clip";
import { span } from "../core/instrument/timing";
import { type Analyze, analyzer } from "../core/model/analyzer";
import { structureAt, type ChapterRow } from "../core/model/docStructure";
import { handleFor, markMoved, type EditorHandle } from "../handle";
import { pairingThere, showBlockPairs, showPaired, type PairedRange } from "../recipes/pairing";
import { modeView, pickChapter, type ProjectionName } from "../views";
import { revealInBand } from "./align";

export interface ReferenceOptions {
  /** Where the view mounts. */
  readonly parent: HTMLElement;
  /** The whole book, as the reference resource holds it. */
  readonly text: string;
  /** This view's own engine — composition's `galley.memoize()`, one per view. */
  readonly analyze: Analyze;
  /** The projection to open in; `setMode` moves it afterwards. */
  readonly mode: ProjectionName;
  /** Draw the paired block? The reader's setting at mount; `pairBlocks` moves it. */
  readonly pairBlocks?: boolean;
  /**
   * The reader clicked or tapped the text at `offset` — for the host to show
   * the same place in the book. A drag that selects text is not a place.
   */
  readonly onPlace?: (offset: number) => void;
}

export interface ReferenceMount extends EditorHandle {
  /** Follows the main editor's projection. Idempotent. */
  setMode(mode: ProjectionName): void;
  /**
   * Clips the reference to the chapter NUMBERED `chapter` (`\c`'s own label),
   * or shows the whole book with `null`. Answers whether the reference has
   * that chapter at all.
   */
  clipTo(chapter: number | null): boolean;
  /**
   * Scrolls the chapter numbered `chapter` to the top of the pane, the way a
   * chapter click does in the editor. Answers whether it was found.
   */
  showChapter(chapter: number): boolean;
  /**
   * Marks the range that answers where the caret is, or clears it with `null`,
   * and brings it into view.
   *
   * `reveal` is the pane's own "follow the book" switch. A pinned pane still
   * MARKS the pair — the answer is worth having even when you have asked the
   * page to hold still — it just does not scroll to it.
   *
   * When it does scroll: only when the answer leaves the middle band, and
   * then to the centre (`revealInBand`, the aligned group's own rule). A pane
   * that re-centres on every verse fights the reader for the viewport; one
   * that never scrolls marks a verse three screens away; and "nearest", which
   * this was, stopped the pair on the bottom line — on screen, nowhere near
   * the eye. Reading down the middle of a chapter is still still.
   */
  showPair(range: PairedRange | null, reveal?: boolean): void;
  /** Follows the reader's "show what the markup corresponds to" setting. */
  pairBlocks(on: boolean): void;
  destroy(): void;
}

const chapterNumbered = (state: EditorState, number: number): ChapterRow | undefined =>
  structureAt(state).chapters.find((row) => Number.parseInt(row.label, 10) === number);

export function mountReference(options: ReferenceOptions): ReferenceMount {
  const done = span("reference-mount", `${(options.text.length / 1024) | 0}KB`);
  const projection = new Compartment();

  const state = EditorState.create({
    doc: options.text,
    extensions: [
      analyzer.of(options.analyze),
      readingLayer,
      viewLayer(),
      projection.of(modeView(options.mode)),
      hiddenFrontMatter(),
      pairingThere(options.pairBlocks === true),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  });

  const view = new EditorView({ state, parent: options.parent });
  done();

  const { onPlace } = options;
  const clicked = (event: MouseEvent): void => {
    if (onPlace === undefined || !view.state.selection.main.empty) return;
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (at !== null) onPlace(at);
  };
  view.contentDOM.addEventListener("click", clicked);

  const mount = handleFor(view, {
    setMode: (mode: ProjectionName) => {
      view.dispatch({ effects: projection.reconfigure(modeView(mode)) });
    },

    clipTo: (chapter: number | null) => {
      if (chapter === null) {
        view.dispatch(pickChapter(view.state, null));
        return true;
      }
      const row = chapterNumbered(view.state, chapter);
      view.dispatch(pickChapter(view.state, row?.ordinal ?? null));
      return row !== undefined;
    },

    showChapter: (chapter: number) => {
      const row = chapterNumbered(view.state, chapter);
      if (row === undefined) return false;
      markMoved(view);
      view.dispatch({ effects: EditorView.scrollIntoView(anchorFrom(row), { y: "start" }) });
      return true;
    },

    showPair: (range: PairedRange | null, reveal = true) => {
      showPaired(view, range);
      if (range === null || !reveal) return;
      revealInBand(view, range.from);
    },

    pairBlocks: (on: boolean) => {
      showBlockPairs(view, on);
    },

    destroy: () => {
      view.contentDOM.removeEventListener("click", clicked);
      view.destroy();
    },
  });
  return mount;
}
