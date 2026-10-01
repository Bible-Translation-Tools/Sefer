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

import { EditorView } from "@codemirror/view";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";
import {
  mountReader,
  policyKey,
  type EditorPolicy,
  type Funnel,
  type MarkedRange,
  type ReaderMount,
} from "#editor/index";

import "#editor/editor.css";

export interface ExcerptReaderProps {
  readonly analysis: Analysis;
  readonly span: { readonly from: number; readonly to: number };
  /** How the text is drawn and guarded (`editorPolicy`): the screen's choice, not the card's. */
  readonly policy: EditorPolicy;
  readonly marks: readonly MarkedRange[];
  /** Names the view in the timing ring. */
  readonly label: string;
  /**
   * The seated Book of this text, when one is open: the view follows its
   * published changes, so it shows another card's typing as it happens.
   */
  readonly follow?: Funnel | undefined;
  /**
   * Double-click: edit. `at` is the source offset under the pointer, and the
   * point rides along for the satellite — laid out identically — to answer.
   */
  readonly onEdit?: (at: number | undefined, point?: { x: number; y: number }) => void;
  /** One click edits, and the reader is a tab stop; otherwise a double-click. */
  readonly direct?: boolean;
  /**
   * Handed the view's own scroll-to: `at` (a source offset, the view's
   * document being the source) brought to the top of whatever scrolls it —
   * the editor's `scrollIntoView`, as the book editor lands on a verse.
   */
  readonly onReveal?: (reveal: (at: number) => void) => void;
}

export function ExcerptReader(props: ExcerptReaderProps) {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "readerHost",
  });
  const [live, setLive] = createSignal<ReaderMount | undefined>(undefined, {
    name: "readerMount",
  });

  /**
   * The parse, compared by identity before the mount effect sees it. Reading
   * `props.analysis` also reads `props.excerpt`, and widening a card hands it
   * a NEW excerpt over the SAME parse; without this the effect's compute
   * returned a fresh `{ parent, analysis }` on every widen, and the view was
   * destroyed and remounted — the card collapsed for a frame and the list
   * below it jumped — where `reclip` was all it needed.
   */
  const analysis = createMemo(() => props.analysis, { name: "readerAnalysis" });
  /** The same, for the policy: a screen that rebuilds an equal policy moves nothing. */
  const policy = createMemo(() => props.policy, {
    name: "readerPolicy",
    equals: (a, b) => policyKey(a) === policyKey(b),
  });

  // Rebuilt only for a different parse — a different text. Everything else a
  // card changes (its range, its marks, the mode) moves the live view.
  createEffect(
    () => ({ parent: host(), analysis: analysis() }),
    ({ parent, analysis }) => {
      if (parent === undefined) return;
      const mount = mountReader({
        parent,
        analysis,
        range: untrack(() => props.span),
        policy: untrack(policy),
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
    () => live(),
    (mount) => {
      if (mount === undefined) return;
      const view = mount.view;
      props.onReveal?.((at) => {
        view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "start" }) });
      });
    },
  );

  createEffect(
    () => ({ mount: live(), span: props.span }),
    ({ mount, span }) => mount?.reclip(span),
  );
  createEffect(
    () => ({ mount: live(), policy: policy() }),
    ({ mount, policy }) => mount?.setPolicy(policy),
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
    const at = mount === undefined ? null : mount.view.posAtCoords(point);
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
