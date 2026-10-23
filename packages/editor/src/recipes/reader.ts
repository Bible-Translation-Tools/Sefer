import { type ChangeSet, Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sameSource, type Analysis } from "@sefer/text/engine/analysis";

import { analyzer } from "../core/analyzer";
import { readingLayer, viewLayer } from "../core/compose";
import { borrowedStructure, structureAt, type DocStructure } from "../core/docStructure";
import { renderRangeField } from "../core/render";
import { span } from "../core/timing";
import { fromCanonical, funnelOf, type Following, type Funnel } from "../funnel";
import { handleFor, type EditorHandle } from "../handle";
import { policyKey, policyView, type EditorPolicy } from "../views";
import {
  clipped,
  markedRanges,
  reclip,
  remark,
  satelliteRange,
  clipSpan,
  clipSpanOf,
  wholeLinesOf,
  type MarkedRange,
} from "./satellite";
import { giveBack, takeView } from "./viewPool";

const CATCH_UP_MS = 400;

export interface ReaderOptions {
  readonly parent: HTMLElement;
  /** The whole text's parse. The view's document is `analysis.text`. */
  readonly analysis: Analysis;
  /** What to show, in source coordinates. Snapped to whole lines here. */
  readonly range: { readonly from: number; readonly to: number };
  /** How the reader draws: the surface's behaviour matrix (`editorPolicy`). */
  readonly policy: EditorPolicy;
  readonly marks: readonly MarkedRange[];
  /** The stylesheet's name for the surface — `cm-excerpt`. */
  readonly surface: string;
  /** Names the view in the timing ring. */
  readonly label: string;
  /**
   * Whether a press selects text, as in any page. `false` for a reader whose
   * click opens an editor in its place (a Key terms card): there a selection
   * is never kept, and CodeMirror's mouse handling only re-reads coordinates
   * a just re-clipped view may not have caught up with — after a card gained a
   * verse above, it threw inside `posAtCoords` on the opening click.
   */
  readonly selectable?: boolean;
}

export interface ReaderMount extends EditorHandle {
  setPolicy(policy: EditorPolicy): void;
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
  follow(host: Following | undefined): boolean;
  destroy(): void;
}

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

const lent = new WeakMap<Analysis, DocStructure>();

export function mountReader(options: ReaderOptions): ReaderMount {
  const done = span("reader-mount", options.label);
  const projection = new Compartment();
  const { analysis } = options;
  const text = analysis.text;
  let followed: Funnel | undefined;

  const state = EditorState.create({
    doc: text,
    extensions: [
      analyzer.of(() => analysis),
      borrowedStructure.of(() => followed?.structure() ?? null),
      borrowedStructure.of(() => lent.get(analysis) ?? null),
      readingLayer,
      viewLayer(),
      projection.of(policyView(options.policy, options.surface)),
      clipped(clipSpanOf(text, options.range)),
      renderRangeField.init(() => wholeLinesOf(text, options.range)),
      markedRanges(options.marks),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      options.selectable === false ? EditorView.domEventHandlers({ mousedown: () => true }) : [],
    ],
  });
  if (!lent.has(analysis)) lent.set(analysis, structureAt(state));

  const view = takeView(state);
  options.parent.appendChild(view.dom);
  done();

  let policy = options.policy;
  let clip = clipSpanOf(text, options.range);
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

  return handleFor(view, {
    setPolicy: (next: EditorPolicy) => {
      if (policyKey(next) === policyKey(policy)) return;
      policy = next;
      view.dispatch({ effects: projection.reconfigure(policyView(next, options.surface)) });
    },
    reclip: (range: { readonly from: number; readonly to: number }) => {
      flush();
      const next = clipSpan(view.state.doc, range);
      if (next.from === clip.from && next.to === clip.to) return;
      clip = next;
      reclip(view, next);
    },
    remark: (next: readonly MarkedRange[]) => {
      flush();
      if (next === marks || sameMarks(next, marks)) return;
      marks = next;
      remark(view, next);
    },
    follow: (following: Following | undefined) => {
      stop();
      if (following === undefined) return true;
      const host = funnelOf(following);
      const seated = host.structure().analysis;
      if (seated === undefined || seated === null || !sameSource(seated, analysis)) return false;
      followed = host;
      const detachHost = host.attach((changes) => {
        const windowRange = satelliteRange(view.state) ?? { from: 0, to: view.state.doc.length };
        const from =
          pending === undefined ? windowRange.from : pending.mapPos(windowRange.from, -1);
        const to = pending === undefined ? windowRange.to : pending.mapPos(windowRange.to, 1);
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
  });
}
