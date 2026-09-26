/**
 * The reader: a read-only view of ONE range of a text, painted exactly as the
 * editor paints it.
 *
 * This is what an excerpt card shows until the reader asks to edit it — Zed's
 * multibuffer shape, a small piece of the file. It is the editor's READING half
 * over the book's text (the structure, the projection, the decorations; the
 * same `usfm-p`, verse pips and chapter rules) with the satellite's own clip
 * over it, so a card in Find reads like the page it came from and not like a
 * flattened quotation of it.
 *
 * It is not a satellite: nothing here writes, so there is no Funnel and no seat.
 * An excerpt list must not seat every book it shows — a seat is an editor-
 * backed Book with a journal behind it — and a card that is only being read
 * needs none of that. Edit swaps this view for a satellite over the same range
 * (`ExcerptEditor`), at the same place, in the same projection: to the reader
 * one surface became writable.
 *
 * Read-only is said TWICE, as `reference.ts` says it: `EditorState.readOnly`
 * for commands, `EditorView.editable` so the browser never composes into it.
 *
 * ## One parse, one structure, per book
 *
 * The caller hands over the book's `Analysis`, and the analyzer answers with it
 * — the view's document IS that analysis' text, so no card ever parses. The
 * editor's `DocStructure` built over it is lent to every later view of the same
 * analysis (`borrowedStructure`), so forty cards over one book build it once.
 */

import { type ChangeSet, Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { Analysis } from "#core/galley";

import { analyzer } from "../core/analyzer";
import { readingLayer, viewLayer } from "../core/compose";
import { borrowedStructure, structureAt, type DocStructure } from "../core/docStructure";
import { renderRangeField } from "../core/render";
import { span } from "../core/timing";
import { fromCanonical, type Funnel } from "../funnel";
import { modeView, type ProjectionName } from "../views";
import {
  clipped,
  markedRanges,
  reclip,
  remark,
  satelliteRange,
  wholeLines,
  type MarkedRange,
} from "./satellite";

export interface ReaderOptions {
  readonly parent: HTMLElement;
  /** The whole text's parse. The view's document is `analysis.text`. */
  readonly analysis: Analysis;
  /** What to show, in source coordinates. Snapped to whole lines here. */
  readonly range: { readonly from: number; readonly to: number };
  readonly mode: ProjectionName;
  readonly marks: readonly MarkedRange[];
  /** The stylesheet's name for the surface — `cm-excerpt`. */
  readonly surface: string;
  /** Names the view in the timing ring. */
  readonly label: string;
}

export interface ReaderMount {
  readonly view: EditorView;
  setMode(mode: ProjectionName): void;
  /** Shows another range of the same text; the view is kept, not rebuilt. */
  reclip(range: { readonly from: number; readonly to: number }): void;
  remark(marks: readonly MarkedRange[]): void;
  /**
   * Follows the canonical Book while one is seated for this text: its
   * accepted changes are applied here as they are published, and its parse is
   * borrowed, so a card shows what another card — or the editor — just typed.
   * `undefined` stops following. Refused (answers false) when the seat's text
   * is not this view's: then the caller's next excerpt is the fresh one.
   */
  follow(host: Funnel | undefined): boolean;
  destroy(): void;
}

/**
 * `wholeLines` over a string, before there is a document to ask: the start of
 * the line `from` is on, to the end of the line before `to`.
 */
const linesOf = (
  text: string,
  range: { readonly from: number; readonly to: number },
): { from: number; to: number } => {
  const start = Math.max(0, Math.min(range.from, text.length));
  const end = Math.max(start, Math.min(range.to, text.length));
  const last = Math.max(start, end - 1);
  const close = text.indexOf("\n", last);
  return {
    from: start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1,
    to: close < 0 ? text.length : close,
  };
};

const sameMarks = (a: readonly MarkedRange[], b: readonly MarkedRange[]): boolean =>
  a.length === b.length &&
  a.every((mark, at) => {
    const other = b[at];
    return (
      other !== undefined &&
      mark.from === other.from &&
      mark.to === other.to &&
      mark.class === other.class
    );
  });

/**
 * Retired reader views, kept to be handed the next card's state.
 *
 * A windowed list mounts a card and unmounts another on nearly every frame it
 * scrolls, and constructing an `EditorView` was most of a card's cost: the
 * constructor reads `document.fonts.ready`, which forces a style recalculation
 * of the whole page (~3.5 ms a card on en_ulb Psalms), and it sets
 * `contenteditable` on a connected element, which Chrome answers with editing-
 * state work of its own. A view given a new state with `setState` pays
 * neither. Every reader has the same shape — read-only, no plugins that hold
 * anything outside their state — so any retired view can take any card.
 *
 * Bounded: a list shows twenty or so cards, and more than that retired at
 * once is a list that went away, not one that is scrolling.
 */
const POOL_LIMIT = 32;

/** How long typing must pause before a card the typing did not touch catches up. */
const CATCH_UP_MS = 400;
const pool: EditorView[] = [];

const takeView = (state: EditorState): EditorView => {
  const held = pool.pop();
  if (held === undefined) return new EditorView({ state });
  held.setState(state);
  return held;
};

const giveBack = (view: EditorView): void => {
  view.dom.remove();
  if (pool.length < POOL_LIMIT) pool.push(view);
  else view.destroy();
};

/** The structure first built over each parse, lent to every later reader of it. */
const lent = new WeakMap<Analysis, DocStructure>();

export function mountReader(options: ReaderOptions): ReaderMount {
  const done = span("reader-mount", options.label);
  const projection = new Compartment();
  const { analysis } = options;
  const text = analysis.text;
  /** The seat this view follows, while it follows one. */
  let followed: Funnel | undefined;

  const state = EditorState.create({
    doc: text,
    extensions: [
      // The document never changes, so it is always the text this parse
      // describes; anything else asked of it would be a bug upstream.
      analyzer.of(() => analysis),
      // The seat's parse first, while following one: after a published
      // change it is the only parse that describes this document.
      borrowedStructure.of(() => followed?.structure() ?? null),
      borrowedStructure.of(() => lent.get(analysis) ?? null),
      readingLayer,
      viewLayer(),
      projection.of(modeView(options.mode, options.surface)),
      clipped(linesOf(text, options.range)),
      // The render window starts as the clip. Left to itself it starts as
      // nothing, which the decorator reads as "the whole document" — every
      // card decorated its whole book, and then again once the view reported
      // its viewport. Seeded, a card decorates the lines it shows.
      renderRangeField.init(() => linesOf(text, options.range)),
      markedRanges(options.marks),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  });
  if (!lent.has(analysis)) lent.set(analysis, structureAt(state));

  const view = takeView(state);
  options.parent.appendChild(view.dom);
  done();

  // What the view was last given, so a caller that re-sends the same value —
  // every Solid effect runs once on mount with what the view was built with —
  // costs nothing. A reconfigure rebuilds every decoration, and on a list that
  // mounts a card per frame while scrolling that was the largest single cost.
  let mode = options.mode;
  let clip = linesOf(text, options.range);
  let marks = options.marks;
  let detach: (() => void) | undefined;
  /**
   * What the seat has published and this view has not applied yet.
   *
   * Following is lazy, deliberately. Every card of the book is a follower,
   * and applying each keystroke to twenty of them re-planned and re-decorated
   * twenty documents inside the keystroke (~30 ms of it, on Psalms). Changes
   * compose for nothing, so they are held: a card whose clip the change
   * touched applies them on the next frame, and the rest catch up once the
   * typing pauses.
   */
  let pending: ChangeSet | undefined;
  let frame: number | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (idle !== undefined) clearTimeout(idle);
    frame = undefined;
    idle = undefined;
    const changes = pending;
    pending = undefined;
    if (changes !== undefined) view.dispatch({ changes, annotations: fromCanonical.of(true) });
  };
  const stop = (): void => {
    detach?.();
    detach = undefined;
    followed = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (idle !== undefined) clearTimeout(idle);
    frame = undefined;
    idle = undefined;
  };

  return {
    view,
    setMode: (next) => {
      if (next === mode) return;
      mode = next;
      view.dispatch({ effects: projection.reconfigure(modeView(next, options.surface)) });
    },
    reclip: (range) => {
      // A range is in the canonical text's coordinates: catch up first.
      flush();
      const next = wholeLines(view.state.doc, range);
      if (next.from === clip.from && next.to === clip.to) return;
      clip = next;
      reclip(view, next);
    },
    remark: (next) => {
      flush();
      if (next === marks || sameMarks(next, marks)) return;
      marks = next;
      remark(view, next);
    },
    follow: (host) => {
      stop();
      if (host === undefined) return true;
      if (!host.doc().eq(view.state.doc)) return false;
      followed = host;
      const detachHost = host.attach((changes) => {
        // Where this card's clip is, in the coordinates the change is in:
        // the view has not applied what is still pending.
        const win = satelliteRange(view.state) ?? { from: 0, to: view.state.doc.length };
        const from = pending === undefined ? win.from : pending.mapPos(win.from, -1);
        const to = pending === undefined ? win.to : pending.mapPos(win.to, 1);
        pending = pending === undefined ? changes : pending.compose(changes);
        if (changes.touchesRange(from, to) !== false) {
          if (frame === undefined) frame = requestAnimationFrame(flush);
        } else {
          if (idle !== undefined) clearTimeout(idle);
          idle = setTimeout(flush, CATCH_UP_MS);
        }
      });
      detach = () => {
        detachHost();
        flush();
      };
      return true;
    },
    destroy: () => {
      pending = undefined;
      stop();
      giveBack(view);
    },
  };
}
