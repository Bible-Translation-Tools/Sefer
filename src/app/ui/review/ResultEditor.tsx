/**
 * One change of the review's RESULT, opened for editing: a satellite over the
 * real Book, clipped to the card's lines — the same thing an excerpt card's
 * Edit opens (`excerpts/ExcerptEditor.tsx`), and for the same reason. It holds
 * no text of its own: an edit here goes through the Book's funnel under this
 * projection and range, lands in the Book, is one step of its Undo, and comes
 * back as the canonical text, which the review then compares again.
 *
 * That is what "take theirs, then fix the comma" needs: the result is not a
 * preview the next decision rebuilds, it is the working text itself.
 */

import { Compartment, Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { createEffect, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";
import {
  analyzer,
  clippedToScope,
  modeView,
  mountSatellite,
  readingLayer,
  wholeLines,
  type EditorBook,
  type Satellite,
} from "#editor/index";

import "#editor/editor.css";

const viewFor = (usfm: boolean) => modeView(usfm ? "usfm" : "default", "cm-excerpt");

export function ResultEditor(props: {
  readonly book: EditorBook;
  /** The card's stretch of the book, in its current text. */
  readonly range: { readonly from: number; readonly to: number };
  readonly usfm: boolean;
  readonly analyze: (text: string) => Analysis;
  readonly label: string;
  /** Escape, or Done. */
  readonly onDone: () => void;
}) {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "resultHost",
  });
  const [live, setLive] = createSignal<
    { readonly satellite: Satellite; readonly mode: Compartment } | undefined
  >(undefined, { name: "resultSatellite" });

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
      const mode = new Compartment();
      const release = book.hold();
      const satellite = mountSatellite({
        parent,
        host: book.funnel(),
        range,
        editable: true,
        label: untrack(() => props.label),
        extensions: [
          mode.of(viewFor(untrack(() => props.usfm))),
          analyzer.of(untrack(() => props.analyze)),
          readingLayer,
          clippedToScope(),
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
      satellite.view.dispatch({ selection: { anchor: range.from } });
      satellite.view.focus();
      setLive({ satellite, mode });
      // Returned, and no signal write: this runs inside the row's disposal too.
      return () => {
        satellite.destroy();
        release();
      };
    },
  );

  createEffect(
    () => ({ held: live(), usfm: props.usfm }),
    ({ held, usfm }) => {
      held?.satellite.view.dispatch({ effects: held.mode.reconfigure(viewFor(usfm)) });
    },
  );

  return <div class="cm-host" ref={setHost} />;
}
