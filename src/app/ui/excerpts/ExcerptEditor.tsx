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

import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

import type { Excerpt } from "../../../core/excerpts/excerpts";
import type { Analysis } from "../../../core/galley";
import {
  analyzer,
  clippedToScope,
  markedRanges,
  mountSatellite,
  readingLayer,
  type EditorBook,
} from "../../../editor";

import "../../../editor/editor.css";

export interface ExcerptEditorProps {
  readonly book: EditorBook;
  readonly excerpt: Excerpt;
  /** The book's own memo, so the satellite never parses a second time. */
  readonly analyze: (text: string) => Analysis;
  /** Escape, or the Done button. */
  readonly onDone: () => void;
}

export function ExcerptEditor(props: ExcerptEditorProps) {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "excerptHost",
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
      const doc = book.state.doc;
      const length = doc.length;

      // Snap to lines, and clamp: the excerpt was built from a text the book
      // may have moved past, and a range outside the document draws nothing.
      const start = Math.max(0, Math.min(excerpt.span.from, length));
      const end = Math.max(start, Math.min(excerpt.span.to, length));
      // `end` is the next verse's anchor, which sits at the START of its own
      // line; taking that line's end would pull the following verse into the
      // excerpt, so the last line is the one before it.
      const range = { from: doc.lineAt(start).from, to: doc.lineAt(Math.max(start, end - 1)).to };

      const release = book.hold();
      const satellite = mountSatellite({
        parent,
        host: book.funnel(),
        range,
        editable: true,
        label: `excerpt:${excerpt.sid}`,
        extensions: [
          // Through the facet, not `dom.classList`: CodeMirror rewrites the
          // editor's class on every update from `editorAttributes`, so a class
          // added by hand survives exactly until the first keystroke.
          EditorView.editorAttributes.of({ class: "cm-mode-regular cm-excerpt" }),
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

      onCleanup(() => {
        satellite.destroy();
        release();
      });
    },
  );

  return <div class="cm-host" ref={setHost} />;
}
