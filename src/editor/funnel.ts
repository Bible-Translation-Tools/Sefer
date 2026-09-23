/**
 * Funnel — the port a satellite or a window submits an edit through.
 *
 * Every surface that is NOT the canonical seat — an editable satellite over a
 * note, a result card, a source mirror — needs three things and no more: the
 * text as it stands, a way to offer changes, and a way to hear the changes
 * that were accepted (its own included, coming back). That is this interface.
 * It exists so those surfaces depend on a four-method port rather than on the
 * editor-backed Book, and so the answer to "how does this edit reach the
 * file?" is always the same: `book.apply`.
 *
 * `Receive` hands out CodeMirror's `ChangeSet` rather than `Change[]` because
 * a borrowing surface must MAP its own caret and its own clip through the same
 * change description the canonical state used — `ChangeSet.mapPos` is that,
 * and rebuilding it from offsets would be a second, subtly different mapping.
 * The Book port's own `changes(fn)` publishes core `Change[]`, for readers that
 * hold no CodeMirror state at all. Both fire from the same publication.
 */

import { Annotation, type ChangeSet, type EditorState, type Text } from "@codemirror/state";

import type { Origin, Receipt, Refusal, Trust } from "#core/book/book";
import type { Change } from "#core/source/source";

import type { DocStructure } from "./core/docStructure";

/**
 * "This transaction is the canonical text coming back to me; do not resubmit
 * it." Defined once for the whole editor: a window and a satellite must agree
 * on the marking, or one of them re-submits what the other already accepted
 * and the edit lands twice.
 */
export const fromCanonical = Annotation.define<boolean>();

/** Told what was accepted, and the state that now holds it. */
export type Receive = (changes: ChangeSet, state: EditorState) => void;

export interface Funnel {
  /** The canonical text, as CodeMirror holds it — no string is allocated. */
  doc(): Text;
  /**
   * The canonical parse, for a surface that wants to borrow rather than
   * re-analyze. See `borrowedStructure`.
   */
  structure(): DocStructure;
  /**
   * Offer changes in the coordinates of the text BEFORE the edit. Runs the
   * phases; one history event. The `Refusal` is the phases' own, so a surface
   * can say WHICH rule closed the door.
   */
  submit(changes: readonly Change[], origin: Origin, trust?: Trust): Receipt | Refusal;
  /** Synchronous publication of accepted changes, in subscription order. */
  attach(receive: Receive): () => void;
  undo(): boolean;
  redo(): boolean;
  depth(): { readonly undo: number; readonly redo: number };
}

/** `Change[]` from a CodeMirror `ChangeSet`, in before-text coordinates. */
export const changesOf = (changes: ChangeSet): Change[] => {
  const out: Change[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    out.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  return out;
};
