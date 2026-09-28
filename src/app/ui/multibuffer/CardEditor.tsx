/**
 * A card opened for editing: a satellite over the canonical Book, clipped to
 * the card's lines — the one editing host every card in Sefer uses (Find, Key
 * terms, Findings, Review).
 *
 * It is NOT a copy of the text and holds no text of its own:
 * `mountSatellite`'s discipline is that a local edit becomes changes, goes
 * through the `Funnel` (the Book's own phases, under this card's projection,
 * mode and range), and comes back as the canonical text. So an edit here is
 * the same edit the main editor would have made: one write path, one history,
 * one undo — and nothing outside the card's lines, however the edit arrives.
 *
 * What it adds over `mountSatellite`:
 *
 *  - The clip is snapped to whole LINES: `collapseOutside` replaces what is
 *    outside the range with block widgets, and a block replacement that does
 *    not start and end at a line boundary is not something CodeMirror draws.
 *  - The reading layer, so the card looks like the page rather than like USFM.
 *    The canonical parse is borrowed, so opening a card costs no second
 *    analysis of the book.
 *  - The same look everywhere while editing: the accent outline (`cm-editing`)
 *    and context at full strength. Escape ends the edit.
 *  - `extensions`, for what a screen draws on the text while it is edited —
 *    Review's live diff.
 */

import { Compartment, Prec, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { createEffect, createSignal, untrack } from "solid-js";

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

export interface CardEditorProps {
  readonly book: EditorBook;
  /** The card's stretch of the book, in source offsets. Widening re-clips. */
  readonly range: { readonly from: number; readonly to: number };
  readonly mode: "regular" | "usfm";
  /** The stylesheet's surface: `cm-excerpt` unless the card has its own. */
  readonly surface?: string;
  /** The book's own memo, so the satellite never parses a second time. */
  readonly analyze: (text: string) => Analysis;
  /** What the reader was painting, so the highlights survive the swap. */
  readonly marks?: readonly MarkedRange[];
  /** Where the caret starts, in source offsets: where a double-click landed. */
  readonly at?: number | undefined;
  /** Where a double-click landed on a view with no offsets to give (a stamp). */
  readonly point?: { x: number; y: number } | undefined;
  /** Selected when neither of the above says where: the first match, say. */
  readonly select?: { readonly from: number; readonly to: number } | undefined;
  readonly extensions?: readonly Extension[];
  /** Names the surface in the origin of its edits and in the trace. */
  readonly label: string;
  /** Handed the live view, for a caller that repaints on it. */
  readonly onView?: (view: EditorView | undefined) => void;
  /** Escape. The card's Done button calls the same thing. */
  readonly onDone: () => void;
}

const viewFor = (mode: "regular" | "usfm", surface: string) =>
  modeView(mode === "usfm" ? "usfm" : "default", surface);

export function CardEditor(props: CardEditorProps) {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "cardEditorHost",
  });
  const [live, setLive] = createSignal<
    { readonly satellite: Satellite; readonly mode: Compartment } | undefined
  >(undefined, { name: "cardEditorLive" });

  // An effect rather than a render effect: the view measures itself, so it is
  // constructed after its parent is in the document.
  createEffect(
    () => host(),
    (parent) => {
      if (parent === undefined) return;
      // One book over one stretch: a different card is a different instance.
      const book = untrack(() => props.book);
      const range = wholeLines(
        book.state.doc,
        untrack(() => props.range),
      );
      const surface = untrack(() => props.surface) ?? "cm-excerpt";
      const at = untrack(() => props.at);
      const point = untrack(() => props.point);
      const select = untrack(() => props.select);
      const mode = new Compartment();
      const release = book.hold();
      const satellite = mountSatellite({
        parent,
        host: book.funnel(),
        range,
        editable: true,
        label: untrack(() => props.label),
        extensions: [
          mode.of(
            viewFor(
              untrack(() => props.mode),
              surface,
            ),
          ),
          analyzer.of(untrack(() => props.analyze)),
          readingLayer,
          clippedToScope(),
          markedRanges(untrack(() => props.marks) ?? []),
          ...(untrack(() => props.extensions) ?? []),
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
      // button, on the first match — what they clicked Edit about, not the top
      // of the context above it. The satellite's own filters settle either
      // onto a legal stop.
      const view = satellite.view;
      const pointed = point === undefined ? null : view.posAtCoords(point);
      if (at === undefined && pointed !== null && pointed >= range.from && pointed <= range.to)
        view.dispatch({ selection: { anchor: pointed } });
      else if (at !== undefined && at >= range.from && at <= range.to)
        view.dispatch({ selection: { anchor: at } });
      else if (select !== undefined && select.from >= range.from && select.to <= range.to)
        view.dispatch({ selection: { anchor: select.from, head: select.to } });
      else view.dispatch({ selection: { anchor: range.from } });
      view.focus();
      setLive({ satellite, mode });
      untrack(() => props.onView)?.(view);

      // RETURNED, not `onCleanup`: an effect's callback runs with no owner in
      // Solid 2, so an `onCleanup` here never ran (NO_OWNER_CLEANUP). And no
      // signal write: this also runs when a list unmounts the row, inside the
      // owner's disposal, where a write is refused.
      return () => {
        untrack(() => props.onView)?.(undefined);
        satellite.destroy();
        release();
      };
    },
  );

  // The mode, dispatched into the live view: a projection is presentation, not
  // an edit, so the caret, the selection and the scroll survive the switch.
  createEffect(
    () => ({ held: live(), name: props.mode }),
    ({ held, name }) => {
      if (held === undefined) return;
      const surface = untrack(() => props.surface) ?? "cm-excerpt";
      held.satellite.view.dispatch({ effects: held.mode.reconfigure(viewFor(name, surface)) });
    },
  );

  // A wider card is a WIDER WINDOW on the same book: re-clipped, not rebuilt,
  // so somebody who asked to see one more verse keeps their caret.
  createEffect(
    () => ({ held: live(), range: props.range }),
    ({ held, range }) => {
      if (held === undefined) return;
      reclip(held.satellite.view, wholeLines(held.satellite.view.state.doc, range));
    },
  );

  // The match cursor moved, or the results were re-taken: repaint, keep the view.
  createEffect(
    () => ({ held: live(), marks: props.marks }),
    ({ held, marks }) => {
      if (held === undefined || marks === undefined) return;
      remark(held.satellite.view, marks);
    },
  );

  return <div class="cm-host cm-editing" data-card-editor ref={setHost} />;
}
