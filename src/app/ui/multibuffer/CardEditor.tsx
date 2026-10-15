/**
 * A card opened for editing: a satellite over the canonical Book, clipped to
 * the card's lines — the one editing host every card in Sefer uses (Find, Key
 * terms, Findings, Review).
 *
 * It is NOT a copy of the text and holds no text of its own: the editor's
 * card mount (`mountCard`) sends a local edit through the Book's funnel — the
 * Book's own phases, under this card's projection, mode and range — and it
 * comes back as the canonical text. So an edit here is the same edit the main
 * editor would have made: one write path, one history, one undo — and nothing
 * outside the card's lines, however the edit arrives.
 *
 * This component is the Solid half only: it mounts the card once, and moves
 * it as its props change — the policy, the range, the marks. The look while
 * editing (`cm-editing`) is the same everywhere, and Escape ends the edit.
 */

import {
  mountCard,
  policyKey,
  type CardMount,
  type DiffPaint,
  type EditorBook,
  type EditorPolicy,
  type MarkedRange,
} from "@sefer/editor";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";

import "@sefer/editor/editor.css";

export interface CardEditorProps {
  readonly book: EditorBook;
  /** The card's stretch of the book, in source offsets. Widening re-clips. */
  readonly range: { readonly from: number; readonly to: number };
  /** How the text is drawn and guarded (`editorPolicy`); the Book judges edits under it too. */
  readonly policy: EditorPolicy;
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
  /** A live diff drawn over the text while it is edited: Review's. */
  readonly diff?: DiffPaint;
  /** Track the card's own edits so they can be cancelled (`CardMount.session`). */
  readonly session?: boolean;
  /**
   * Re-clip when `range` changes (default). A card whose range is recomputed
   * on every comparison (Review) passes false: while it is edited, the editor's
   * own range, mapped through the typing, is the truth.
   */
  readonly reclip?: boolean;
  /** Names the surface in the origin of its edits and in the trace. */
  readonly label: string;
  /** Handed the mounted card, for a caller that repaints or cancels on it. */
  readonly onEditor?: (card: CardMount | undefined) => void;
  /** Escape. The card's Done button calls the same thing. */
  readonly onDone: () => void;
}

export function CardEditor(props: CardEditorProps) {
  /** Compared by what it says, so an equal policy rebuilt upstream reconfigures nothing. */
  const policy = createMemo(() => props.policy, {
    name: "cardPolicy",
    equals: (a, b) => policyKey(a) === policyKey(b),
  });
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "cardEditorHost",
  });
  const [live, setLive] = createSignal<CardMount | undefined>(undefined, {
    name: "cardEditorLive",
  });

  // An effect rather than a render effect: the view measures itself, so it is
  // constructed after its parent is in the document.
  createEffect(
    () => host(),
    (parent) => {
      if (parent === undefined) return;
      // One book over one stretch: a different card is a different instance.
      // The caret starts where the reader double-clicked; from the Edit
      // button, on the first match — what they clicked Edit about, not the top
      // of the context above it.
      // Read once: a prop is an expression, and Review's paint is computed in it.
      const diff = untrack(() => props.diff);
      const card = untrack(() =>
        mountCard({
          parent,
          book: props.book,
          range: props.range,
          policy: policy(),
          surface: props.surface ?? "cm-excerpt",
          analyze: props.analyze,
          marks: props.marks ?? [],
          ...(diff === undefined ? {} : { diff }),
          session: props.session === true,
          caret: { at: props.at, point: props.point, select: props.select },
          onEscape: () => props.onDone(),
          label: props.label,
        }),
      );
      setLive(card);
      untrack(() => props.onEditor)?.(card);

      // RETURNED, not `onCleanup`: an effect's callback runs with no owner in
      // Solid 2, so an `onCleanup` here never ran (NO_OWNER_CLEANUP). And no
      // signal write: this also runs when a list unmounts the row, inside the
      // owner's disposal, where a write is refused.
      return () => {
        untrack(() => props.onEditor)?.(undefined);
        card.destroy();
      };
    },
  );

  // The mode, in the live view: a projection is presentation, not an edit, so
  // the caret, the selection and the scroll survive the switch.
  createEffect(
    () => ({ card: live(), next: policy() }),
    ({ card, next }) => card?.setPolicy(next),
  );

  // A wider card is a WIDER WINDOW on the same book: re-clipped, not rebuilt,
  // so somebody who asked to see one more verse keeps their caret.
  createEffect(
    () => ({ card: live(), range: props.range }),
    ({ card, range }) => {
      if (card === undefined || untrack(() => props.reclip) === false) return;
      card.setRange(range);
    },
  );

  // The match cursor moved, or the results were re-taken: repaint, keep the view.
  createEffect(
    () => ({ card: live(), marks: props.marks }),
    ({ card, marks }) => {
      if (card === undefined || marks === undefined) return;
      card.setMarks(marks);
    },
  );

  return <div class="cm-host cm-editing" data-card-editor ref={setHost} />;
}
