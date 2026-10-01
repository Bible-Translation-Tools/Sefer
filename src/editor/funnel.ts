/**
 * Funnel — the port a satellite submits an edit through.
 *
 * Every surface that is NOT the canonical seat — a Find or Key terms excerpt,
 * the note editor — needs three things and no more: the text as it stands, a
 * way to offer changes, and a way to hear the changes that were accepted (its
 * own included, coming back). That is this interface. It exists so those
 * surfaces depend on a small port rather than on the editor-backed Book, and
 * so the answer to "how does this edit reach the file?" is always the same:
 * the Book's own phases, then its one publication.
 *
 * An edit travels with its surface's TERMS — the projection it was made in,
 * the mode, and the range the surface covers — and the Book judges it under
 * them (`EditorBook.applyFrom`). One judge, the same rules as the canonical
 * editor, and nothing trusted: a surface that shows a footnote's body is
 * judged as a surface that shows it, rather than by the canonical projection,
 * which hides it.
 *
 * `Receive` hands out CodeMirror's `ChangeSet` rather than `Change[]` because
 * a borrowing surface must MAP its own caret and its own range through the
 * same change description the canonical state used — `ChangeSet.mapPos` is
 * that, and rebuilding it from offsets would be a second, subtly different
 * mapping. The Book port's own `changes(fn)` publishes core `Change[]`, for
 * readers that hold no CodeMirror state at all. Both fire from the same
 * publication.
 */

import { Annotation, type ChangeSet, type EditorState, type Text } from "@codemirror/state";

import type { Origin, Receipt, Refusal } from "#core/book/book";
import type { Change } from "#core/source/source";

import type { DocStructure } from "./core/docStructure";
import type { Tracer } from "./core/instrument";
import type { Mode } from "./core/kernel";
import type { AssignmentDelta } from "./core/registry";

/**
 * "This transaction is the canonical text coming back to me; do not resubmit
 * it." Defined once for the whole editor, so every borrowing surface marks the
 * returning text the same way and none of them re-submits what the Book
 * already accepted.
 */
export const fromCanonical = Annotation.define<boolean>();

/** Told what was accepted, and the state that now holds it. */
export type Receive = (changes: ChangeSet, state: EditorState) => void;

/**
 * What the submitting surface shows, which is what its edit is judged under.
 *
 * `projection` is the surface's own assignment deltas (`Assignment.deltas`),
 * `mode` its `modeFacet`, and `range` the part of the book it covers — which
 * the Book guards as it guards the chapter clip, except that no trust waives
 * it. Data, not rules: the rules are the Book's.
 */
export interface SurfaceTerms {
  readonly projection: readonly AssignmentDelta[];
  readonly mode: Mode;
  readonly range: { readonly from: number; readonly to: number };
  /**
   * The gesture's own CodeMirror `userEvent` in the surface — `input.type`,
   * `input.paste`, `delete.backward` — when it had one. Several rules act on
   * the kind of gesture (a typed backslash, a pasted chapter, markup pasted
   * inside a word), and without it a satellite's paste reached them as an
   * anonymous change and they let it through.
   */
  readonly event?: string;
}

export interface Funnel {
  /** The canonical text, as CodeMirror holds it — no string is allocated. */
  doc(): Text;
  /**
   * The canonical parse, for a surface that wants to borrow rather than
   * re-analyze. See `borrowedStructure`.
   */
  structure(): DocStructure;
  /**
   * Offer changes in the coordinates of the text BEFORE the edit, with the
   * terms of the surface they were made in. Runs the Book's phases under
   * those terms; one history event. The `Refusal` is the phases' own, so a
   * surface can say WHICH rule closed the door.
   */
  submit(changes: readonly Change[], origin: Origin, terms: SurfaceTerms): Receipt | Refusal;
  /** Synchronous publication of accepted changes, in subscription order. */
  attach(receive: Receive): () => void;
  undo(): boolean;
  redo(): boolean;
  depth(): { readonly undo: number; readonly redo: number };
  /**
   * The Book's own tracer, so a surface's keypress decisions — a card's
   * Backspace verdict — land on the same Observability ring as the Book's
   * judgement of the edit they produce. Absent, the surface traces locally.
   */
  tracer?(): Tracer | null;
}

/** `Change[]` from a CodeMirror `ChangeSet`, in before-text coordinates. */
export const changesOf = (changes: ChangeSet): Change[] => {
  const out: Change[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    out.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  return out;
};
