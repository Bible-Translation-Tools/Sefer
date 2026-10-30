import {
  isolateHistory,
  redo as cmRedo,
  redoDepth,
  undo as cmUndo,
  undoDepth,
} from "@codemirror/commands";
import {
  Annotation,
  EditorState,
  Prec,
  StateEffect,
  Transaction,
  type Extension,
  type Text,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  Refusal,
  UNTRUSTED,
  asChangeList,
  makeListeners,
  type Book,
  type History,
  type Origin,
  type Receipt,
  type Trust,
} from "@sefer/text/book";
import type { Change, Source, SourceStamp } from "@sefer/text/source";
import { Result } from "effect";

import { clipboardOrigin } from "./core/clipboard";
import { actionCommand, type EditorAction } from "./core/commands/actions";
import { historyLayer, judgeLayer, usfmEditorHeadless } from "./core/compose";
import { surfaceRange } from "./core/guards/clip";
import { traceOf } from "./core/instrument/instrument";
import { clearRefusal, lastRefusal, localTracer, tracer } from "./core/instrument/instrument";
import { modeFacet, trusted } from "./core/kernel";
import type { Analyze } from "./core/model/analyzer";
import { docText, structureAt, type DocStructure } from "./core/model/docStructure";
import { assignment } from "./core/model/registry";
import { withoutScrolling } from "./core/scroll";
import {
  changesOf,
  fromCanonical,
  madeFunnel,
  type Following,
  type Funnel,
  type Receive,
  type SurfaceTerms,
} from "./funnel";
import { observabilityTracer, type EditorObservability } from "./observability";
import { emptyBlocks } from "./recipes/emptyBlocks";

/**
 * A Book whose text lives in a CodeMirror state, plus the four things only
 * such a Book can answer. It satisfies `Seated`, so `openProject`'s `seat`
 * option accepts it (`services.ts` builds that seat).
 */
/**
 * A seated book, as a host holds it: the Book, plus what the editor adds that
 * a host may ask — its parse, the caret, the blocks still to fill, a named
 * gesture, a hold, and a token a reader can follow it by. Nothing here is
 * CodeMirror's; `SeatedBook` below is the whole of it, inside the package.
 */
export interface EditorBook extends Book {
  /** The canonical parse, for a surface that borrows instead of analyzing. */
  structure(): DocStructure;
  /** The main selection: the caret is `head`, and an empty one has `from === to`. */
  selection(): {
    readonly anchor: number;
    readonly head: number;
    readonly from: number;
    readonly to: number;
  };
  /** The blocks a translator still has to fill: where each one's text goes, and its marker. */
  emptyBlocks(): readonly { readonly from: number; readonly marker: string }[];
  /** Views plus satellites currently holding this book; blocks `project.release`. */
  attached(): number;
  /** A non-view attachment (a satellite). Release to let go. */
  hold(): () => void;
  /**
   * Runs one named editor gesture — an insertion, focusing the front matter
   * card — against whichever seat is canonical, and reports whether it ran.
   *
   * The gesture builds its own transaction from the CURRENT selection and
   * dispatches it, so the phases judge it exactly as they judge a keystroke
   * and it lands as one Undo step. Named rather than passed as a function
   * because the caller is the shell, and the shell does not import CodeMirror.
   */
  perform(action: EditorAction): boolean;
  /** This book as something a reader can follow (`ReaderMount.follow`). */
  funnel(): Following;
  /** Drops the state, the view binding and every subscriber. */
  close(): void;
}

/** The whole seated book, CodeMirror's vocabulary included. Package-internal. */
export interface SeatedBook extends EditorBook {
  /** The canonical state: the bound view's when one is bound, else the held one. */
  readonly state: EditorState;
  /**
   * Binds a view to this book's state; returns the unbind. The view MUST route
   * its transactions through `fromView` (`dispatchTransactions: (trs) =>
   * book.fromView(view, trs)`) — that is where a keystroke becomes a receipt
   * every reader sees. Binding a view that dispatches on its own makes the
   * book's publication silently incomplete, so `apply` throws rather than
   * report a receipt nobody heard.
   */
  bindView(view: EditorView): () => void;
  /** The bound view's dispatch hook: update the view, then publish. */
  fromView(view: EditorView, trs: readonly Transaction[]): void;
  /**
   * An edit from a SURFACE, judged under that surface's terms — its
   * projection, its mode, its range — by the Book's own phases, then
   * committed and published like any other.
   *
   * This is how a satellite's edit is judged by the rules and not waved
   * through: the canonical projection hides a footnote's body, so judging the
   * note editor's keystrokes there refuses every one of them, and trust was
   * the old way round that. Here the phases see what the surface shows, and
   * the surface's range is refused past exactly as the chapter clip is.
   */
  applyFrom(
    terms: SurfaceTerms,
    changes: readonly Change[],
    origin: Origin,
  ): Result.Result<Receipt, Refusal>;
  /** Publication in CodeMirror's own vocabulary, for borrowing surfaces. */
  attach(receive: Receive): () => void;
  /** This book as the port satellites submit through. */
  funnel(): Funnel;
}

const seatedBooks = new WeakSet<EditorBook>();

/** The whole seated book behind an `EditorBook` a host handed back. */
export const seatedOf = (book: EditorBook): SeatedBook => {
  if (!seatedBooks.has(book)) throw new Error("not a book this editor seated");
  // SAFETY: only `editorBook` adds to `seatedBooks`, and what it adds is a `SeatedBook`.
  return book as SeatedBook;
};

export interface EditorBookOptions {
  /** The engine for this book — composition passes `galley.memoize()`. */
  readonly analyze: Analyze;
  /** Extra extensions for the canonical state (a linter, a projection). */
  readonly extensions?: Extension;
  /** When present, `apply` and refusals are noted. Absent is fine. */
  readonly observability?: EditorObservability;
}

const originAnnotation = Annotation.define<Origin>();

const originOf = (tr: Transaction): Origin => {
  const named = tr.annotation(originAnnotation);
  if (named !== undefined) return named;
  const event = tr.annotation(Transaction.userEvent);
  if (event === undefined) return "keyboard";
  return event.startsWith("input.") ? event.slice("input.".length) : event;
};

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

const minimalChanges = (changes: readonly Change[], doc: Text): readonly Change[] =>
  changes.map((change) => {
    const removed = doc.sliceString(change.from, change.to);
    const insert = change.insert;
    const most = Math.min(removed.length, insert.length);
    let head = 0;
    while (head < most && removed.charCodeAt(head) === insert.charCodeAt(head)) head += 1;
    if (head > 0 && isHighSurrogate(removed.charCodeAt(head - 1))) head -= 1;
    let tail = 0;
    while (
      tail < most - head &&
      removed.charCodeAt(removed.length - 1 - tail) === insert.charCodeAt(insert.length - 1 - tail)
    )
      tail += 1;
    if (tail > 0 && isLowSurrogate(removed.charCodeAt(removed.length - tail))) tail -= 1;
    if (head === 0 && tail === 0) return change;
    return {
      from: change.from + head,
      to: change.to - tail,
      insert: insert.slice(head, insert.length - tail),
    };
  });

export const editorBook = (plain: Book, options: EditorBookOptions): SeatedBook => {
  const { id, path } = plain;
  const observability = options.observability;
  const listeners = makeListeners();
  const receivers = new Set<Receive>();

  let revision = plain.source().stamp.revision;
  const form = plain.source().form;
  let holds = 0;
  let closed = false;

  let own = EditorState.create({
    doc: plain.source().text,
    extensions: [
      usfmEditorHeadless({ analyze: options.analyze }),
      clipboardOrigin.of(id),
      historyLayer,
      Prec.lowest(
        tracer.of(
          observability === undefined ? localTracer : observabilityTracer(observability, id),
        ),
      ),
      options.extensions ?? [],
    ],
  });
  let view: EditorView | null = null;
  let judging: EditorState | null = null;

  const state = (): EditorState => (view === null ? own : view.state);

  const stamp = (): SourceStamp => ({ revision, length: state().doc.length });

  const round = (ms: number): number => Math.round(ms * 1000) / 1000;

  const accept = (tr: Transaction, before: SourceStamp, origin: Origin): Receipt => {
    revision += 1;
    const receipt: Receipt = { before, after: stamp(), origin };
    const now = state();
    const broadcast = performance.now();
    for (const receive of Array.from(receivers)) receive(tr.changes, now);
    const satellites = performance.now();
    listeners.publish(receipt, changesOf(tr.changes));
    const published = performance.now();
    const fields = {
      "book.id": id,
      "book.origin": origin,
      "book.revision": receipt.after.revision,
      "book.revision_before": before.revision,
      "book.receivers": receivers.size,
      "book.broadcast_ms": round(satellites - broadcast),
      "book.publish_ms": round(published - satellites),
    };
    const trace = traceOf(judging ?? tr.startState);
    if (trace === null) observability?.note("book.apply", "rewrote", undefined, fields);
    else trace.annotate(fields);
    return receipt;
  };

  const refuse = (origin: Origin, count: number, judged?: EditorState): Refusal => {
    const first = lastRefusal();
    const rule = first?.rule ?? "editor.phases";
    const fields = {
      "book.id": id,
      "book.origin": origin,
      "book.rule": rule,
      "book.changes": count,
    };
    const trace = traceOf(judged ?? state());
    if (trace === null) observability?.note("book.apply", "refused", first?.detail, fields);
    else trace.annotate(fields);
    return new Refusal({
      rule,
      reason: first?.detail ?? "Refused",
      description: `${id} refused ${count} change(s) from ${origin}`,
    });
  };

  const specFor = (changes: readonly Change[], origin: Origin, trust: Trust, event?: string) => {
    const annotations = [
      originAnnotation.of(origin),
      ...(trust.trusted ? [trusted.of(trust.by)] : []),
      ...(origin.startsWith("project.") ? [isolateHistory.of("full" as const)] : []),
    ];
    return {
      changes: changes.map((change) => ({
        from: change.from,
        to: change.to,
        insert: change.insert,
      })),
      userEvent: event ?? `input.${origin}`,
      annotations,
    };
  };

  const command = (
    run: (target: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean,
  ): boolean => {
    const bound = view;
    if (bound !== null) {
      if (bound.hasFocus) return run(bound);
      return withoutScrolling(() => run(bound));
    }
    const landed: Transaction[] = [];
    const before = stamp();
    const ok = run({
      state: own,
      dispatch: (tr) => {
        landed.push(tr);
      },
    });
    const tr = landed[0];
    if (!ok || tr === undefined) return false;
    own = tr.state;
    if (tr.docChanged) accept(tr, before, "history");
    return true;
  };

  const commit = (
    spec: TransactionSpec,
    origin: Origin,
    count: number,
  ): Result.Result<Receipt, Refusal> => {
    const before = stamp();
    const bound = view;
    if (bound !== null) {
      const doc = bound.state.doc;
      bound.dispatch(spec);
      if (bound.state.doc === doc) return Result.fail(refuse(origin, count));
      if (revision === before.revision) {
        throw new Error(
          "editorBook: the bound view accepted an edit without going through fromView; " +
            "bind it with dispatchTransactions: (trs) => book.fromView(view, trs)",
        );
      }
      return Result.succeed({ before, after: stamp(), origin });
    }
    const tr = own.update(spec);
    own = tr.state;
    if (!tr.docChanged) return Result.fail(refuse(origin, count));
    return Result.succeed(accept(tr, before, origin));
  };

  const judgeFor = (terms: SurfaceTerms): EditorState => {
    const canonical = state();
    return canonical.update({
      effects: StateEffect.reconfigure.of([
        judgeLayer({ analyze: options.analyze }),
        terms.projection.map((delta) => assignment.of(delta)),
        modeFacet.of(terms.mode),
        surfaceRange.of({ from: terms.range.from, to: terms.range.to }),
        tracer.of(canonical.facet(tracer) ?? localTracer),
      ]),
      filter: false,
    }).state;
  };

  const book: SeatedBook = {
    id,
    path,

    get state() {
      return state();
    },

    source: (): Source => ({ text: docText(state()), stamp: stamp(), form }),

    structure: () => structureAt(state()),

    selection: () => {
      const { anchor, head, from, to } = state().selection.main;
      return { anchor, head, from, to };
    },

    emptyBlocks: () => emptyBlocks(state()),

    apply: (changes, origin, trust = UNTRUSTED): Result.Result<Receipt, Refusal> => {
      const list = asChangeList(changes);
      clearRefusal();
      return commit(specFor(list, origin, trust), origin, list.length);
    },

    applyFrom: (terms, changes, origin) => {
      const list = minimalChanges(asChangeList(changes), state().doc);
      clearRefusal();
      const judge = judgeFor(terms);
      const judged = judge.update(specFor(list, origin, UNTRUSTED, terms.event));
      if (!judged.docChanged) return Result.fail(refuse(origin, list.length, judge));
      judging = judge;
      try {
        return commit(
          {
            ...specFor([], origin, UNTRUSTED, terms.event),
            changes: judged.changes,
            filter: false,
          },
          origin,
          list.length,
        );
      } finally {
        judging = null;
      }
    },

    changes: listeners.add,

    perform: (action) => command(actionCommand(action)),

    attach: (receive) => {
      receivers.add(receive);
      return () => {
        receivers.delete(receive);
      };
    },

    history: (): History => ({
      undo: () => command(cmUndo),
      redo: () => command(cmRedo),
      depth: () => ({ undo: undoDepth(state()), redo: redoDepth(state()) }),
    }),

    bindView: (bound) => {
      view = bound;
      return () => {
        if (view !== bound) return;
        own = bound.state;
        view = null;
      };
    },

    fromView: (bound, trs) => {
      bound.update(trs);
      for (const tr of trs) {
        if (!tr.docChanged || tr.annotation(fromCanonical) === true) continue;
        accept(tr, { revision, length: tr.startState.doc.length }, originOf(tr));
      }
    },

    attached: () => (view === null ? holds : holds + 1),

    hold: () => {
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
      };
    },

    funnel: () => funnelFor(book),

    close: () => {
      if (closed) return;
      closed = true;
      view = null;
      receivers.clear();
      observability?.note("seat.close", "consumed", undefined, { "book.id": id });
    },
  };

  seatedBooks.add(book);
  return book;
};

/**
 * The editor-backed Book as a `Funnel`. A thin adapter, not a second write
 * path: `submit` is `applyFrom` under the surface's terms, and the result is
 * unwrapped because a satellite wants the `Refusal` itself (to say which rule
 * refused) rather than a Result it must destructure.
 */
export const funnelFor = (book: SeatedBook): Funnel =>
  madeFunnel({
    kind: "funnel",
    doc: () => book.state.doc,
    structure: () => book.structure(),
    submit: (changes, origin, terms) => {
      const result = book.applyFrom(terms, changes, origin);
      return Result.isSuccess(result) ? result.success : result.failure;
    },
    attach: book.attach,
    undo: () => book.history()?.undo() ?? false,
    redo: () => book.history()?.redo() ?? false,
    depth: () => book.history()?.depth() ?? { undo: 0, redo: 0 },
    tracer: () => book.state.facet(tracer),
  });
