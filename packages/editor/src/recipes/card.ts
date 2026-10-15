/**
 * A card's editor: a satellite over one stretch of an editor-backed Book,
 * mounted whole — the projection, the reading layer, the clip, the marks, a
 * live diff, Escape, where the caret starts, and the Book held while it lives.
 *
 * Every surface that edits a stretch of a book in place — Find's cards, Key
 * terms, Review's live pane and its cards — is this one mount with different
 * options, so a host composes no CodeMirror of its own (planning item
 * "embeddable editor"). Edits go through the Book's funnel and are judged by
 * the Book under the card's policy, as a satellite's always are.
 */

import { ChangeSet, Compartment, Prec, StateField, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import type { EditorBook } from "../book";
import { analyzer, type Analyze } from "../core/analyzer";
import { readingLayer } from "../core/compose";
import { fromCanonical, ownEcho } from "../funnel";
import { handleFor, type EditorHandle } from "../handle";
import { policyView, type EditorPolicy } from "../views";
import { liveDiff, repaintDiff, type DiffPaint } from "./diffView";
import {
  clipSpan,
  clippedToScope,
  markedRanges,
  mountSatellite,
  reclip,
  remark,
  type MarkedRange,
} from "./satellite";

/**
 * Where the caret starts, tried in order: the offset a double-click on the
 * reader gave, the screen point of a double-click on a view with no offsets
 * (a stamp), then a range to select (the first match). Each counts only inside
 * the card; with none of them, the start of the card.
 */
export interface CardCaret {
  readonly at?: number | undefined;
  readonly point?: { readonly x: number; readonly y: number } | undefined;
  readonly select?: { readonly from: number; readonly to: number } | undefined;
}

export interface CardOptions {
  readonly parent: HTMLElement;
  readonly book: EditorBook;
  /** The card's stretch of the book, in source offsets. */
  readonly range: { readonly from: number; readonly to: number };
  /** How the text is drawn and guarded; the Book judges edits under it too. */
  readonly policy: EditorPolicy;
  /** The stylesheet's surface. Default `cm-excerpt`. */
  readonly surface?: string;
  /** The book's own memo, so the card never parses a second time. */
  readonly analyze: Analyze;
  /** Highlights carried over from the reader. Omitted: the card draws none. */
  readonly marks?: readonly MarkedRange[];
  /** A live diff over the card's text, repainted with `setDiff`. */
  readonly diff?: DiffPaint;
  /** Keep the caret and the view inside `range`. Default true. */
  readonly clip?: boolean;
  /**
   * Place the caret (`CardCaret`) and focus the card. Omitted: neither, for a
   * pane that is read beside another before it is edited.
   */
  readonly caret?: CardCaret;
  /** Escape. A card's Done button calls the same thing. */
  readonly onEscape?: () => void;
  /** Track this card's own edits, so they can be cancelled (`session`). */
  readonly session?: boolean;
  /** Names the surface in the origin of its edits and in the trace. */
  readonly label: string;
}

/**
 * An edit session with a way back. Everything typed lands in the Book as it is
 * typed; the session holds the INVERSE of this card's own changes, so `cancel`
 * hands the Book exactly that. A change from anywhere else is mapped over,
 * never composed, so cancelling cannot undo someone else's edit.
 */
export interface CardSession {
  dirty(): boolean;
  /** Called when `dirty` may have changed. Returns the detach. */
  onDirty(listener: (dirty: boolean) => void): () => void;
  /**
   * Hands the Book the inverse of this card's edits. Past the card's own
   * filters — a revert may span a verse number the card's policy makes
   * immortal — but the Book still judges it as an edit.
   */
  cancel(): void;
}

export interface CardMount extends EditorHandle {
  /** The card's range now, mapped through every edit since it was mounted. */
  readonly range: { readonly from: number; readonly to: number };
  setPolicy(policy: EditorPolicy): void;
  /** A wider card is a wider window on the same book: re-clipped, not rebuilt. */
  setRange(range: { readonly from: number; readonly to: number }): void;
  setMarks(marks: readonly MarkedRange[]): void;
  /** Repaints the live diff; `null` clears it. Only for a card mounted with `diff`. */
  setDiff(paint: DiffPaint | null): void;
  /** Present only for a card mounted with `session: true`. */
  readonly session: CardSession | undefined;
  destroy(): void;
}

const NO_PAINT: DiffPaint = { lines: [], marks: [], controls: [] };

const sessionUndo = (): StateField<ChangeSet> =>
  StateField.define<ChangeSet>({
    create: (state) => ChangeSet.empty(state.doc.length),
    update: (held, transaction) => {
      if (!transaction.docChanged) return held;
      const others =
        transaction.annotation(fromCanonical) === true && transaction.annotation(ownEcho) !== true;
      if (others) return held.map(transaction.changes);
      return transaction.changes.invert(transaction.startState.doc).compose(held);
    },
  });

export function mountCard(options: CardOptions): CardMount {
  const { book } = options;
  const surface = options.surface ?? "cm-excerpt";
  const clip = options.clip !== false;
  const range = clip ? clipSpan(book.state.doc, options.range) : options.range;
  const projection = new Compartment();
  const undo = options.session === true ? sessionUndo() : undefined;
  const dirtyListeners = new Set<(dirty: boolean) => void>();
  let dirty = false;

  const extensions: Extension[] = [
    projection.of(policyView(options.policy, surface)),
    analyzer.of(options.analyze),
    readingLayer,
    ...(clip ? [clippedToScope()] : []),
    ...(options.marks === undefined ? [] : [markedRanges(options.marks)]),
    ...(options.diff === undefined ? [] : liveDiff(options.diff)),
    ...(undo === undefined
      ? []
      : [
          undo,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = !update.state.field(undo).empty;
            if (next === dirty) return;
            dirty = next;
            for (const listener of dirtyListeners) listener(dirty);
          }),
        ]),
    ...(options.onEscape === undefined
      ? []
      : [
          Prec.high(
            keymap.of([
              {
                key: "Escape",
                run: () => {
                  options.onEscape?.();
                  return true;
                },
              },
            ]),
          ),
        ]),
  ];

  const release = book.hold();
  const satellite = mountSatellite({
    parent: options.parent,
    host: book.funnel(),
    range,
    editable: true,
    label: options.label,
    extensions,
  });
  const { view } = satellite;

  const caret = options.caret;
  if (caret !== undefined) {
    const inside = (at: number): boolean => at >= range.from && at <= range.to;
    const pointed = caret.point === undefined ? null : view.posAtCoords(caret.point);
    const select = caret.select;
    if (caret.at === undefined && pointed !== null && inside(pointed))
      view.dispatch({ selection: { anchor: pointed } });
    else if (caret.at !== undefined && inside(caret.at))
      view.dispatch({ selection: { anchor: caret.at } });
    else if (select !== undefined && select.from >= range.from && select.to <= range.to)
      view.dispatch({ selection: { anchor: select.from, head: select.to } });
    else view.dispatch({ selection: { anchor: range.from } });
    view.focus();
  }

  return handleFor(view, {
    get range() {
      return satellite.range;
    },
    setPolicy: (policy: EditorPolicy) => {
      view.dispatch({ effects: projection.reconfigure(policyView(policy, surface)) });
    },
    setRange: (next: { readonly from: number; readonly to: number }) => {
      reclip(view, clipSpan(view.state.doc, next));
    },
    setMarks: (marks: readonly MarkedRange[]) => remark(view, marks),
    setDiff: (paint: DiffPaint | null) => repaintDiff(view, paint ?? NO_PAINT),
    session:
      undo === undefined
        ? undefined
        : {
            dirty: () => dirty,
            onDirty: (listener: (dirty: boolean) => void) => {
              dirtyListeners.add(listener);
              return () => dirtyListeners.delete(listener);
            },
            cancel: () => {
              const inverse = view.state.field(undo, false);
              if (inverse !== undefined && !inverse.empty)
                view.dispatch({ changes: inverse, filter: false });
            },
          },
    destroy: () => {
      dirtyListeners.clear();
      satellite.destroy();
      release();
    },
  });
}
