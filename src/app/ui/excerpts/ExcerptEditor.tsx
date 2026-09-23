/**
 * One excerpt, opened for editing: a satellite over the canonical Book,
 * clipped to the excerpt's span.
 *
 * This is the "Edit is a click" half of the multibuffer
 * (planning/03-ui/design-direction.md, "Find"). It is NOT a copy of the text
 * and it holds no text of its own — `mountSatellite`'s whole discipline is
 * that a local edit becomes changes, goes through the `Funnel` (which is
 * `book.apply`, phases and all), and comes back as the canonical text. So an
 * edit made here is the same edit the main editor would have made: one write
 * path, one history, one undo.
 *
 * Two things this component adds over `mountSatellite`:
 *
 *  - The clip is snapped to whole LINES. `collapseOutside` replaces what is
 *    outside the range with block widgets, and a block replacement that does
 *    not start and end at a line boundary is not something CodeMirror will
 *    draw. The excerpt's span is a verse anchor, which is a position in a
 *    line; the satellite's is the lines that contain it.
 *  - The reading layer, so the excerpt looks like the page rather than like
 *    USFM. The canonical parse is borrowed (`mountSatellite` lends it), so
 *    opening a card costs no second analysis of the book.
 */

import { Compartment, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

import type { Excerpt } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import {
  analyzer,
  assignment,
  clippedToScope,
  markedRanges,
  modeFacet,
  mountSatellite,
  projectionFor,
  readingLayer,
  reclip,
  type EditorBook,
  type Satellite,
} from "#editor/index";

import "#editor/editor.css";

export interface ExcerptEditorProps {
  readonly book: EditorBook;
  readonly excerpt: Excerpt;
  /**
   * The shell's mode. It rides a compartment rather than the mount, so
   * switching mode with a card open re-paints the same view instead of
   * destroying it — the caret, the selection and the scroll survive, exactly
   * as they do in the main editor.
   */
  readonly mode: "regular" | "usfm";
  /** The book's own memo, so the satellite never parses a second time. */
  readonly analyze: (text: string) => Analysis;
  /** Escape, or the Done button. */
  readonly onDone: () => void;
}

/** The projection, the facet and the class for one mode, as one extension. */
const viewFor = (mode: "regular" | "usfm") => [
  assignment.of(projectionFor(mode === "usfm" ? "usfm" : "default")),
  modeFacet.of(mode),
  // Through the facet, not `dom.classList`: CodeMirror rewrites the editor's
  // class on every update from `editorAttributes`, so a class added by hand
  // survives exactly until the first keystroke.
  EditorView.editorAttributes.of({ class: `cm-mode-${mode} cm-excerpt` }),
];

/**
 * The excerpt's span, snapped to whole lines and clamped to the document.
 *
 * `collapseOutside` replaces what is outside the range with block widgets,
 * and a block replacement that does not start and end at a line boundary is
 * not something CodeMirror will draw. `end` is the next verse's anchor, which
 * sits at the START of its own line, so the last line is the one before it.
 */
const lineRange = (
  doc: { length: number; lineAt: (at: number) => { from: number; to: number } },
  span: { readonly from: number; readonly to: number },
): { from: number; to: number } => {
  const start = Math.max(0, Math.min(span.from, doc.length));
  const end = Math.max(start, Math.min(span.to, doc.length));
  return { from: doc.lineAt(start).from, to: doc.lineAt(Math.max(start, end - 1)).to };
};

export function ExcerptEditor(props: ExcerptEditorProps) {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "excerptHost",
  });
  const [live, setLive] = createSignal<Satellite | undefined>(undefined, {
    name: "excerptSatellite",
  });
  const [mode, setMode] = createSignal<Compartment | undefined>(undefined, {
    name: "excerptMode",
  });

  // An effect rather than a render effect: the view measures itself, so it is
  // constructed after its parent is in the document.
  createEffect(
    () => host(),
    (parent) => {
      if (parent === undefined) return;
      // Deliberate one-time reads: a satellite is built for ONE book over ONE
      // span, and a different excerpt is a different component instance.
      const book = untrack(() => props.book);
      const excerpt = untrack(() => props.excerpt);
      const analyze = untrack(() => props.analyze);
      const range = lineRange(book.state.doc, excerpt.span);
      const view = new Compartment();
      setMode(view);

      const release = book.hold();
      const satellite = mountSatellite({
        parent,
        host: book.funnel(),
        range,
        editable: true,
        label: `excerpt:${excerpt.sid}`,
        extensions: [
          view.of(viewFor(untrack(() => props.mode))),
          analyzer.of(analyze),
          readingLayer,
          clippedToScope(),
          markedRanges(excerpt.hits.map((hit) => ({ from: hit.from, to: hit.to }))),
          Prec.high(
            keymap.of([
              {
                key: "Escape",
                run: () => {
                  props.onDone();
                  return true;
                },
              },
            ]),
          ),
        ],
      });
      // The caret starts on the first hit, which is what the reader clicked
      // Edit about — not at the top of the context verse.
      const first = excerpt.hits[0];
      if (first !== undefined && first.from >= range.from && first.to <= range.to)
        satellite.view.dispatch({ selection: { anchor: first.from, head: first.to } });
      satellite.view.focus();

      setLive(satellite);

      onCleanup(() => {
        setLive(undefined);
        setMode(undefined);
        satellite.destroy();
        release();
      });
    },
  );

  // The mode, dispatched into the live view. Not a document change, so the
  // Book's funnel ignores it — a projection is presentation, not an edit.
  createEffect(
    () => ({ satellite: live(), view: mode(), name: props.mode }),
    ({ satellite, view, name }) => {
      if (satellite === undefined || view === undefined) return;
      satellite.view.dispatch({ effects: view.reconfigure(viewFor(name)) });
    },
  );

  // An expanded excerpt is a WIDER WINDOW on the same book, so the live view
  // is re-clipped rather than rebuilt: destroying it would lose the caret, the
  // selection and the scroll of someone who asked to see one more verse.
  createEffect(
    () => ({ satellite: live(), span: props.excerpt.span }),
    ({ satellite, span }) => {
      if (satellite === undefined) return;
      reclip(satellite.view, lineRange(satellite.view.state.doc, span));
    },
  );

  return <div class="cm-host" ref={setHost} />;
}
