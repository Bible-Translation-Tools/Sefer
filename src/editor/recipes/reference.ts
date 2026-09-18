/**
 * The reference view: a whole book of ANOTHER resource, painted exactly the
 * way the editor paints the project's own, and read-only.
 *
 * It is not a satellite and not a window. A satellite is a reader that may
 * write — it borrows a `Funnel`, submits changes and waits for the canonical
 * Book to hand them back — and a reference has no canonical Book in this
 * process at all. It is a second text, from a second resource, that nobody in
 * Sefer may edit. So the recipe takes a STRING and an `Analyze`, and gives
 * back a view that can only be read from.
 *
 * What it installs is the editor's READING half and nothing else:
 *
 *  - `analyzer` + `readingLayer` — the structure, the pick, the projection and
 *    the decorations. This is what makes the reference look like the editor:
 *    same `usfm-p`, same verse pips, same chapter rules, because it is the
 *    same `decoField` over the same `DocStructure`.
 *  - `viewLayer()` — line wrapping, the render window (a 60,000-line reference
 *    is decorated a screenful at a time, like the editor), atomic ranges and
 *    bidi isolates.
 *  - the mode compartment — `assignment`, `modeFacet` and the `cm-mode-*`
 *    editor attribute, the same three things `BookEditor` reconfigures, so
 *    Regular/USFM switches both panes from one shell signal.
 *
 * What it deliberately does NOT install: the kernel phases (`rulesLayer`), the
 * command keymap, history, the linter. A rule that refuses an edit is dead
 * weight over a document no transaction will ever change, and a keymap is a
 * promise the surface cannot keep.
 *
 * Read-only is said TWICE, and both are load-bearing: `EditorState.readOnly`
 * stops any command that asks, and `EditorView.editable` makes the DOM
 * non-editable so the browser never composes into it. Selection still works —
 * a reference you cannot copy out of is not a reference.
 *
 * `borrowedStructure` is not used here for the same reason: the canonical
 * parse in this process describes the PROJECT's book, and this is a different
 * text of the same book. The reference gets its own parse, once — the document
 * never changes, so the memo answers every later read.
 */

import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { type Analyze, analyzer } from "../core/analyzer";
import { anchorFrom } from "../core/clip";
import { readingLayer, viewLayer } from "../core/compose";
import { structureAt, type ChapterRow } from "../core/docStructure";
import { type Mode, modeFacet } from "../core/kernel";
import { assignment } from "../core/registry";
import { span } from "../core/timing";
import { pickChapter, projectionFor, type ProjectionName } from "../views";
import { pairingThere, showBlockPairs, showPaired, type PairedRange } from "./pairing";

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
}

export interface ReferenceMount {
  readonly view: EditorView;
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
   * `y: "nearest"` and not `"center"`, which is the whole difference between
   * this being useful and being unusable: a pane that re-centres on every
   * block change fights the reader for the viewport, and one that never
   * scrolls marks a verse three screens away. Nearest moves only when the
   * answer is off-screen, so reading down a chapter is still.
   */
  showPair(range: PairedRange | null): void;
  /** Follows the reader's "show what the markup corresponds to" setting. */
  pairBlocks(on: boolean): void;
  destroy(): void;
}

const cmMode = (mode: ProjectionName): Mode => (mode === "usfm" ? "usfm" : "regular");

/**
 * The chapter of THIS text numbered `number`.
 *
 * By the `\c` label and not by ordinal, because the two books are different
 * files: the engine's row 0 is the front matter, and one resource may carry a
 * `\toc` block the other does not, so the same chapter can sit at a different
 * index. The number a translator reads is the only thing the two texts are
 * guaranteed to agree about.
 */
const chapterNumbered = (state: EditorState, number: number): ChapterRow | undefined =>
  structureAt(state).chapters.find((row) => Number.parseInt(row.label, 10) === number);

/**
 * The three things a mode IS, as one compartment's contents — the same three
 * `BookEditor` reconfigures. The class rides `editorAttributes` rather than
 * being added to the element, because CodeMirror rewrites `view.dom`'s class
 * attribute from its facets and a hand-added class is wiped on the first
 * layout change.
 */
const modeExtensions = (mode: ProjectionName) => [
  assignment.of(projectionFor(mode)),
  modeFacet.of(cmMode(mode)),
  EditorView.editorAttributes.of({ class: `cm-mode-${cmMode(mode)}` }),
];

export function mountReference(options: ReferenceOptions): ReferenceMount {
  const done = span("reference-mount", `${(options.text.length / 1024) | 0}KB`);
  const projection = new Compartment();

  const state = EditorState.create({
    doc: options.text,
    extensions: [
      analyzer.of(options.analyze),
      readingLayer,
      viewLayer(),
      projection.of(modeExtensions(options.mode)),
      pairingThere(options.pairBlocks === true),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  });

  const view = new EditorView({ state, parent: options.parent });
  done();

  const mount: ReferenceMount = {
    view,

    setMode: (mode) => {
      view.dispatch({ effects: projection.reconfigure(modeExtensions(mode)) });
    },

    clipTo: (chapter) => {
      if (chapter === null) {
        view.dispatch(pickChapter(view.state, null));
        return true;
      }
      const row = chapterNumbered(view.state, chapter);
      // A chapter the reference does not have clears the clip rather than
      // clipping to nothing: an empty pane says "this text stops at 3" much
      // less clearly than the whole book scrolled to where it ends.
      view.dispatch(pickChapter(view.state, row?.ordinal ?? null));
      return row !== undefined;
    },

    showChapter: (chapter) => {
      const row = chapterNumbered(view.state, chapter);
      if (row === undefined) return false;
      view.dispatch({ effects: EditorView.scrollIntoView(anchorFrom(row), { y: "start" }) });
      return true;
    },

    showPair: (range) => {
      showPaired(view, range);
      if (range === null) return;
      view.dispatch({ effects: EditorView.scrollIntoView(range.from, { y: "nearest" }) });
    },

    pairBlocks: (on) => {
      showBlockPairs(view, on);
    },

    destroy: () => {
      view.destroy();
    },
  };
  return mount;
}
