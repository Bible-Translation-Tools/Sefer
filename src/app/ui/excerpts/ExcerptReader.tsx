/**
 * One excerpt, read: the editor's own reading of a range of a book, read-only.
 *
 * The card's resting state (`#editor` `mountReader`). It is a view of the
 * book's text through the book's parse — the same projection, verse pips and
 * paragraph shapes the editor paints — clipped to the excerpt, so a list of
 * results reads like the pages they came from.
 *
 * Double-click is the way in: it hands the source offset under the pointer to
 * `onEdit`, and the card swaps this view for a satellite with the caret there.
 */

import { createEffect, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";
import { mountReader, type Funnel, type MarkedRange, type ReaderMount } from "#editor/index";

import "#editor/editor.css";

export interface ExcerptReaderProps {
  readonly analysis: Analysis;
  readonly span: { readonly from: number; readonly to: number };
  readonly mode: "regular" | "usfm";
  readonly marks: readonly MarkedRange[];
  /** Names the view in the timing ring. */
  readonly label: string;
  /**
   * The seated Book of this text, when one is open: the view follows its
   * published changes, so it shows another card's typing as it happens.
   */
  readonly follow?: Funnel | undefined;
  /** Double-click: edit, with the caret at this source offset. Absent: read-only for good. */
  readonly onEdit?: (at: number | undefined) => void;
}

const projectionOf = (mode: "regular" | "usfm") => (mode === "usfm" ? "usfm" : "default");

export function ExcerptReader(props: ExcerptReaderProps) {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "readerHost",
  });
  const [live, setLive] = createSignal<ReaderMount | undefined>(undefined, {
    name: "readerMount",
  });

  // Rebuilt only for a different parse — a different text. Everything else a
  // card changes (its range, its marks, the mode) moves the live view.
  createEffect(
    () => ({ parent: host(), analysis: props.analysis }),
    ({ parent, analysis }) => {
      if (parent === undefined) return;
      const mount = mountReader({
        parent,
        analysis,
        range: untrack(() => props.span),
        mode: projectionOf(untrack(() => props.mode)),
        marks: untrack(() => props.marks),
        surface: "cm-excerpt",
        label: untrack(() => props.label),
      });
      setLive(mount);
      // RETURNED, not `onCleanup` — an effect's callback has no owner in
      // Solid 2 (see `ExcerptEditor`). No signal write in here: this also runs
      // when the list unmounts the row, inside the owner's disposal, where a
      // write is refused (REACTIVE_WRITE_IN_OWNED_SCOPE). A rebuild for a new
      // parse sets the next mount straight after.
      return () => {
        mount.destroy();
      };
    },
  );

  createEffect(
    () => ({ mount: live(), span: props.span }),
    ({ mount, span }) => mount?.reclip(span),
  );
  createEffect(
    () => ({ mount: live(), mode: props.mode }),
    ({ mount, mode }) => mount?.setMode(projectionOf(mode)),
  );
  createEffect(
    () => ({ mount: live(), marks: props.marks }),
    ({ mount, marks }) => mount?.remark(marks),
  );
  createEffect(
    () => ({ mount: live(), host: props.follow }),
    ({ mount, host }) => {
      if (mount === undefined || host === undefined) return;
      mount.follow(host);
      return () => {
        mount.follow(undefined);
      };
    },
  );

  return (
    <div
      class="cm-host"
      ref={setHost}
      onDblClick={(event) => {
        const edit = props.onEdit;
        if (edit === undefined) return;
        const at = live()?.view.posAtCoords({ x: event.clientX, y: event.clientY });
        edit(at ?? undefined);
      }}
    />
  );
}
