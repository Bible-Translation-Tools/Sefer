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
import {
  mountReader,
  mountStamp,
  type Funnel,
  type MarkedRange,
  type ReaderMount,
  type StampMount,
} from "#editor/index";

import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";

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
  /**
   * Double-click: edit. `at` is the source offset under the pointer when the
   * body is a live view; a stamp has no view to ask, so it hands the point,
   * and the satellite — laid out identically — answers it.
   */
  readonly onEdit?: (at: number | undefined, point?: { x: number; y: number }) => void;
  /** One click edits, and the reader is a tab stop; otherwise a double-click. */
  readonly direct?: boolean;
}

const projectionOf = (mode: "regular" | "usfm") => (mode === "usfm" ? "usfm" : "default");

export function ExcerptReader(props: ExcerptReaderProps) {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "readerHost",
  });
  const [live, setLive] = createSignal<ReaderMount | StampMount | undefined>(undefined, {
    name: "readerMount",
  });
  const shell = useShell();
  /** Read once per card, like every setting a list reads when it opens. */
  const stamped =
    shell.services.settings.get(shellKeys(shell.services.settings).excerptRenderer) === "stamp";

  // Rebuilt only for a different parse — a different text. Everything else a
  // card changes (its range, its marks, the mode) moves the live view.
  createEffect(
    () => ({ parent: host(), analysis: props.analysis }),
    ({ parent, analysis }) => {
      if (parent === undefined) return;
      const mount = (stamped ? mountStamp : mountReader)({
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

  const editAt = (event: MouseEvent): void => {
    const edit = props.onEdit;
    if (edit === undefined) return;
    const mount = live();
    const point = { x: event.clientX, y: event.clientY };
    const at = mount !== undefined && "view" in mount ? mount.view.posAtCoords(point) : null;
    edit(at ?? undefined, point);
  };

  return (
    <div
      class="cm-host"
      ref={setHost}
      tabindex={props.direct === true && props.onEdit !== undefined ? 0 : undefined}
      onDblClick={(event) => {
        if (props.direct !== true) editAt(event);
      }}
      onClick={(event) => {
        if (props.direct === true) editAt(event);
      }}
      onKeyDown={(event) => {
        if (props.direct === true && event.key === "Enter") {
          event.preventDefault();
          props.onEdit?.(undefined);
        }
      }}
    />
  );
}
