/**
 * The book editor: the one view over a seated Book's canonical state.
 *
 * Everything CodeMirror-shaped about showing a whole book lives here, so a
 * host mounts it, moves it with methods and hears from it through callbacks —
 * Sefer's `BookEditor` is a Solid wrapper of this (planning item "embeddable
 * editor"):
 *
 *  - The view is created over `book.state` and every transaction goes through
 *    `book.fromView`, which is where a keystroke becomes a receipt every
 *    reader sees. Binding a view that dispatched on its own would make the
 *    book's publication silently incomplete — `apply` throws rather than
 *    report a receipt nobody heard.
 *  - The mountable half (the meter, the caret report, the front matter card,
 *    empty blocks, pairing, flash) is appended to the Book's canonical state
 *    ONCE PER BOOK, because `appendConfig` through a bound view lands in the
 *    Book and outlives the view.
 *  - Mode and chapter are dispatched through a compartment and a clip. Neither
 *    is a document change, so `fromView` ignores them — a projection is
 *    presentation and a clip is a view choice, and neither is an edit.
 */

import { Compartment, StateEffect, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { EditorBook } from "./book";
import { structureAt } from "./core/editorState";
import { frontMatterCard } from "./core/frontmatter";
import { annotateOpen } from "./core/instrument";
import { keystrokeMeter } from "./core/meter";
import { span } from "./core/timing";
import { handleFor, type EditorHandle } from "./handle";
import { annotateRepaint } from "./observability";
import { annotateEmptyBlocks, blockNamer, showEmptyBlocks } from "./recipes/emptyBlocks";
import { flash, flashing } from "./recipes/flash";
import { showCorpusFindings, type CorpusFinding } from "./recipes/lint";
import { noteBookIs } from "./recipes/noteEditor";
import { pairingHere, showBlockPairs } from "./recipes/pairing";
import { modeView, pickChapter, type ProjectionName } from "./views";

/**
 * A remembered place, by what the document SAYS: a chapter label, a verse
 * number in it, and the exact offset with the length (and hash) it was taken
 * at. See `BookEditorMount.resume`.
 */
export interface RememberedPlace {
  readonly chapter: string;
  readonly verse?: string;
  readonly offset?: number;
  readonly hash?: string;
  readonly length?: number;
}

export interface BookEditorOptions {
  readonly parent: HTMLElement;
  readonly book: EditorBook;
  /** Where the caret is, on every selection change (the head, the end being dragged). */
  readonly onCaret?: (head: number) => void;
  /** What an empty block is called where its words go (`\q2` → "Poetry line"). */
  readonly blockName?: (marker: string) => string;
  /** The empty-block ghost and the block pairing, as the reader's settings start. */
  readonly emptyBlocks?: boolean;
  readonly pairBlocks?: boolean;
}

export interface BookEditorMount extends EditorHandle {
  /**
   * Regular or USFM. Flipping must not move the reader: both modes are the
   * SAME DOCUMENT, so the selection survives, but hidden markup collapses
   * lines, so the top of the viewport is re-anchored in the same transaction.
   */
  setMode(mode: ProjectionName): void;
  /** Clips to the chapter with this ordinal, or shows the whole book with `null`. */
  setChapter(ordinal: number | null): void;
  setEmptyBlocks(on: boolean): void;
  setPairBlocks(on: boolean): void;
  /** The host's own findings for this book, drawn with the engine's as one set. */
  setHostDiagnostics(findings: readonly CorpusFinding[]): void;
  /**
   * Puts the reader back at a remembered place, caret and scroll. Answers the
   * offset it landed on, or undefined when the place no longer resolves (or
   * is the very top).
   */
  resume(place: RememberedPlace): number | undefined;
  /**
   * A jump on purpose: caret and scroll to `range` (the top of the pane for a
   * chapter, the middle for a point inside one), and a flash, so a target
   * already on screen still answers the click. Returns the flash's cancel.
   */
  jump(range: { readonly from: number; readonly to?: number }, at: "top" | "center"): () => void;
  destroy(): void;
}

/**
 * Which books have already had the mountable half appended to their canonical
 * state, and the projection compartment that went in with it. Weak and
 * module-level, because it is a fact about the BOOK and not about one view: a
 * second view over the same book (leave the route, come back) would otherwise
 * append the whole set again — two meters, two notes per keypress, two front
 * matter cards — and a compartment that is not in the config is a
 * reconfigure that does nothing.
 */
const mountedConfig = new WeakMap<EditorBook, Compartment>();

/** Every caret listener of a book, so the once-per-book listener reaches this view's. */
const caretListeners = new WeakMap<EditorBook, Set<(head: number) => void>>();

/**
 * The offset a remembered place names now, or `undefined`.
 *
 * A LADDER, because the document may have moved while the reader was away —
 * they may have been in Find for the express purpose of changing it:
 *
 *   1. the exact offset, when the document is unmoved;
 *   2. the VERSE, by its number, scoped to its chapter;
 *   3. the CHAPTER, by `\c`'s own label;
 *   4. nothing, and stay at the top.
 *
 * Every rung below the first is looked up by what the document SAYS rather
 * than by an ordinal or an offset, so a book that gained a `\toc` line still
 * resolves and a verse that was deleted falls to its chapter instead of
 * landing in whatever now occupies its coordinates.
 */
const placeOf = (state: EditorState, place: RememberedPlace): number | undefined => {
  const structureNow = structureAt(state);
  // The hash when BOTH sides have one — a fresh view has not parsed yet, so
  // `analysis` is routinely null exactly here — and the length otherwise. Same
  // length is weaker than same hash: an edit that swapped one word for another
  // of equal width would pass it, and the cost of being wrong is an offset a
  // few characters stale, which at scroll granularity nobody can see. A
  // different length is proof of change either way, and drops to the verse.
  const hash = structureNow.analysis?.sourceHash;
  const unmoved =
    hash !== undefined && place.hash !== undefined
      ? String(hash) === place.hash
      : place.length === state.doc.length;
  if (place.offset !== undefined && unmoved) return Math.min(place.offset, state.doc.length);
  const chapter = structureNow.chapters.find((row) => row.label === place.chapter);
  if (chapter === undefined) return undefined;
  if (place.verse === undefined) return chapter.from;
  // Scoped to the chapter: verse numbers repeat, and `10` alone names sixty
  // places in a book.
  const verse = structureNow.verses.find(
    (row) =>
      row.markerFrom >= chapter.from && row.markerFrom < chapter.to && row.num === place.verse,
  );
  return verse?.markerFrom ?? chapter.from;
};

/** The document position sitting at the top of the viewport, right now. */
const topOfViewport = (view: EditorView): number | undefined => {
  const box = view.scrollDOM.getBoundingClientRect();
  // A few pixels in, so the probe lands inside the first visible line rather
  // than on the boundary above it.
  return view.posAtCoords({ x: box.left + 4, y: box.top + 4 }) ?? undefined;
};

/** The meter's measurement, onto the gesture it measured, or the repaint nobody typed for. */
const meterFor = (book: EditorBook) =>
  keystrokeMeter((measured) => {
    // Onto the gesture's own record. The meter measures THROUGH the paint,
    // which lands after the transaction's rules are done but before the next
    // transaction opens, so the gesture is still the one that is open — and
    // `annotateOpen` says so rather than assuming it.
    //
    // Both are measured from the DOM EVENT, where the gesture's own span
    // starts at the first phase rule a fraction of a millisecond later — so
    // `to_paint_ms` can read slightly longer than the span that carries it.
    //
    // `to_paint_ms` is also mostly not work: a keystroke that lands mid-frame
    // waits for the next vsync, so ~16ms at 60Hz is the floor, not a cost.
    // `gesture_ms` is the half we can do anything about, and
    // `browser_input_ms` is the part of it the browser owns.
    //
    // `to_paint_source` says which instrument answered. `event` is the
    // browser's own Event Timing number and is what to trust; `frame` is the
    // requestAnimationFrame inference, which reads up to a frame high.
    const painted: Readonly<Record<string, string | number>> =
      measured.render === null
        ? {}
        : {
            "editor.to_paint_ms": measured.render,
            "editor.to_paint_source": measured.renderSource ?? "frame",
          };
    const onGesture = annotateOpen({
      "editor.gesture_ms": measured.gesture,
      "editor.browser_input_ms": measured.browser,
      "editor.analyzes": measured.analyzes,
      "editor.unaccounted_ms": measured.other,
      ...painted,
    });
    if (!onGesture)
      annotateRepaint({ "editor.gesture_ms": measured.gesture, "book.id": book.id, ...painted });
  });

export function mountBookEditor(options: BookEditorOptions): BookEditorMount {
  const { book } = options;
  let view: EditorView | undefined;
  view = new EditorView({
    state: book.state,
    parent: options.parent,
    dispatchTransactions: (transactions) => {
      if (view === undefined) return;
      // CodeMirror's update and DOM sync, named, so the keystroke meter can
      // say where a gesture went instead of leaving it in `other`.
      const done = span("dispatch");
      book.fromView(view, transactions);
      done();
    },
  });
  const created = view;
  const unbind = book.bindView(created);
  // The note editor mounts a satellite over this book, from the Book's funnel;
  // this is the one place that knows both the view and the Book.
  const unname = noteBookIs(created, book);

  let listeners = caretListeners.get(book);
  if (listeners === undefined) {
    listeners = new Set();
    caretListeners.set(book, listeners);
  }
  const onCaret = options.onCaret;
  if (onCaret !== undefined) listeners.add(onCaret);
  const heard = listeners;

  let projection = mountedConfig.get(book);
  if (projection === undefined) {
    projection = new Compartment();
    mountedConfig.set(book, projection);
    created.dispatch({
      effects: StateEffect.appendConfig.of([
        projection.of([]),
        meterFor(book).extension,
        flashing(),
        // Where the caret is, on `selectionSet` and not every update: a
        // document change that does not move the caret is not news, and an
        // update fires for scrolls, measurements and reconfigures too.
        EditorView.updateListener.of((update) => {
          if (!update.selectionSet) return;
          for (const listener of heard) listener(update.state.selection.main.head);
        }),
        frontMatterCard(),
        // Blocks with no words, named where the words go.
        ...(options.blockName === undefined ? [] : [blockNamer.of(options.blockName)]),
        annotateEmptyBlocks(options.emptyBlocks === true),
        // The editor's half of the block pairing: it marks the block the
        // caret is in, and the panes beside it mark the block at the same
        // address.
        pairingHere(options.pairBlocks === true),
      ]),
    });
  }
  const compartment = projection;

  /** The mode the view is configured for, so a flip can be told from a first set. */
  let showing: ProjectionName | undefined;

  return handleFor(created, {
    setMode: (mode: ProjectionName) => {
      const flipped = showing !== undefined && showing !== mode;
      showing = mode;
      const anchor = flipped ? topOfViewport(created) : undefined;
      // The mode class rides the compartment as an editor attribute, not a
      // hand-added class: CodeMirror rewrites `view.dom`'s class attribute
      // from its facets whenever focus changes.
      created.dispatch({
        effects: [
          compartment.reconfigure(modeView(mode)),
          // In the SAME transaction as the reconfigure: a separate dispatch
          // measures the old layout, and the reader is thrown to the top.
          ...(anchor === undefined ? [] : [EditorView.scrollIntoView(anchor, { y: "start" })]),
        ],
      });
    },
    setChapter: (ordinal: number | null) => {
      created.dispatch(pickChapter(created.state, ordinal));
    },
    setEmptyBlocks: (on: boolean) => showEmptyBlocks(created, on),
    setPairBlocks: (on: boolean) => showBlockPairs(created, on),
    setHostDiagnostics: (findings: readonly CorpusFinding[]) =>
      showCorpusFindings(created, [...findings]),
    resume: (place: RememberedPlace) => {
      const at = placeOf(created.state, place);
      if (at === undefined || at <= 0) return undefined;
      // The CARET goes with the scroll: a fresh view puts it at offset 0, and
      // the first thing typed would land at the top of the book.
      created.dispatch({
        selection: { anchor: at },
        effects: EditorView.scrollIntoView(at, { y: "start" }),
      });
      // TWICE, a frame apart. CodeMirror ESTIMATES the height of content it
      // has not rendered, so a jump deep into a book lands approximately; the
      // first scroll measures the region, the second lands on it.
      requestAnimationFrame(() => {
        if (created.dom.isConnected)
          created.dispatch({ effects: EditorView.scrollIntoView(at, { y: "start" }) });
      });
      return at;
    },
    jump: (range: { readonly from: number; readonly to?: number }, at: "top" | "center") => {
      const length = created.state.doc.length;
      const from = Math.min(range.from, length);
      const to = Math.min(range.to ?? from, length);
      // The caret goes where the reader was sent, not only the scroll: every
      // command that asks "which chapter" or "where am I" reads the caret.
      created.dispatch({
        selection: { anchor: from },
        effects: EditorView.scrollIntoView(from, { y: at === "top" ? "start" : "center" }),
      });
      return flash(created, { from, to });
    },
    destroy: () => {
      if (onCaret !== undefined) heard.delete(onCaret);
      unname();
      unbind();
      created.destroy();
    },
  });
}
