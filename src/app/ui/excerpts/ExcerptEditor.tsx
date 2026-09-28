/**
 * One excerpt, opened for editing: a satellite over the canonical Book,
 * clipped to the excerpt's span.
 *
 * This is the "Edit is a click" half of the multibuffer
 * (`documentation/architecture/design-direction.md`, "Find"). It is NOT a
 * copy of the text and it holds no text of its own — `mountSatellite`'s whole
 * discipline is that a local edit becomes changes, goes through the `Funnel`
 * (the Book's own phases, run under this excerpt's projection, mode and range),
 * and comes back as the canonical text. So an edit made here is the same edit
 * the main editor would have made: one write path, one history, one undo —
 * and nothing outside the excerpt's lines, however the edit arrives.
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
import { keymap } from "@codemirror/view";
import { createEffect, createSignal, untrack } from "solid-js";

import type { Excerpt } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import {
  analyzer,
  clippedToScope,
  markedRanges,
  modeView,
  mountSatellite,
  readingLayer,
  reclip,
  remark,
  wholeLines,
  type EditorBook,
  type MarkedRange,
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
  /** What the reader view was painting, so the highlights survive the swap. */
  readonly marks: readonly MarkedRange[];
  /**
   * Where the caret starts, in source coordinates: where the reader
   * double-clicked. Absent — the Edit button — it starts on the first hit.
   */
  readonly at?: number | undefined;
  /**
   * Where the reader double-clicked on a STAMPED body, which has no view to
   * turn a point into an offset. The satellite is laid out like the stamp, so
   * it answers the same point with the same place.
   */
  readonly point?: { x: number; y: number } | undefined;
  /** Escape, or the Done button. */
  readonly onDone: () => void;
}

/** The projection, the facet and the class for one mode, as one extension. */
const viewFor = (mode: "regular" | "usfm") =>
  modeView(mode === "usfm" ? "usfm" : "default", "cm-excerpt");

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
      const range = wholeLines(book.state.doc, excerpt.span);
      const at = untrack(() => props.at);
      const point = untrack(() => props.point);
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
          markedRanges(untrack(() => props.marks)),
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
      // The caret starts where the reader double-clicked; from the Edit
      // button, on the first hit — what they clicked Edit about, not the top
      // of the context above it. The satellite's own filters settle either
      // onto a legal stop.
      const first = excerpt.hits[0];
      const pointed = point === undefined ? null : satellite.view.posAtCoords(point);
      if (at === undefined && pointed !== null && pointed >= range.from && pointed <= range.to)
        satellite.view.dispatch({ selection: { anchor: pointed } });
      else if (at !== undefined && at >= range.from && at <= range.to)
        satellite.view.dispatch({ selection: { anchor: at } });
      else if (first !== undefined && first.from >= range.from && first.to <= range.to)
        satellite.view.dispatch({ selection: { anchor: first.from, head: first.to } });
      satellite.view.focus();

      setLive(satellite);

      // RETURNED, not `onCleanup`: an effect's callback runs with no owner in
      // Solid 2, so an `onCleanup` registered inside it never ran
      // (NO_OWNER_CLEANUP) — BookEditor's mount effect learned the same. Every
      // excerpt ever opened stayed attached: its view still received every
      // publication (the fifth excerpt opened on a book reported five
      // receivers on each receipt) and its hold kept `project.release` refusing.
      //
      // And no signal write: this also runs when the list unmounts the row,
      // inside the owner's disposal, where a write is refused
      // (REACTIVE_WRITE_IN_OWNED_SCOPE) — scrolling an open card out of the
      // window took the list down with it.
      return () => {
        satellite.destroy();
        release();
      };
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
      reclip(satellite.view, wholeLines(satellite.view.state.doc, span));
    },
  );

  // The match cursor moved, or the context changed: repaint, keep the view.
  createEffect(
    () => ({ satellite: live(), marks: props.marks }),
    ({ satellite, marks }) => {
      if (satellite === undefined) return;
      remark(satellite.view, marks);
    },
  );

  return <div class="cm-host cm-editing" data-excerpt-editor ref={setHost} />;
}
