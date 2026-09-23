/**
 * The editor-backed Book: a `Book` (src/core/book/book.ts) whose canonical
 * text is a CodeMirror `EditorState` (editor-and-save §1.1–§1.4).
 *
 * This is the Plain → Instantiated transition made real. A plain Book holds a
 * `Source` and applies changes with Source's own range checks; this one holds
 * a state, and `apply` runs the editing phases — admission, normalization,
 * protection, settlement — before anything is accepted. Readers cannot tell
 * the two apart: same `source()`, same `apply`, same `changes(fn)`.
 *
 * The invariant this file exists to protect: **one canonical text**. From the
 * moment the state is created FROM the plain Book's text, the state IS the
 * text; `source()` derives a string from it (cached per state, so a reader may
 * ask on every publish). Nothing else holds an editable copy — a bound view
 * shares this state, and a window or satellite borrows and forwards.
 *
 * Why a class-free closure: everything mutable here (the held state, the bound
 * view, the revision counter, the subscriber sets) is one book's identity, and
 * a closure states that without a `this`. Why the seat is not a proxy: a hop
 * between the canonical state and its readers would land on the keystroke
 * path, which §1.2 rules out.
 */

import {
  isolateHistory,
  redo as cmRedo,
  redoDepth,
  undo as cmUndo,
  undoDepth,
} from "@codemirror/commands";
import { EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Result } from "effect";

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
} from "#core/book/book";
import type { ObservabilityService } from "#core/observability";
import type { Change, Source, SourceStamp } from "#core/source/source";

import { actionCommand, type EditorAction } from "./core/actions";
import type { Analyze } from "./core/analyzer";
import { historyLayer, usfmEditorHeadless } from "./core/compose";
import { docText, structureAt, type DocStructure } from "./core/docStructure";
import { traceOf } from "./core/instrument";
import { clearRefusal, lastRefusal, localTracer, tracer } from "./core/instrument";
import { trusted } from "./core/kernel";
import { withoutScrolling } from "./core/scroll";
import { changesOf, fromCanonical, type Funnel, type Receive } from "./funnel";
import { observabilityTracer } from "./observability";

/**
 * A Book whose text lives in a CodeMirror state, plus the four things only
 * such a Book can answer. It satisfies `Seated`, so `openProject`'s `seat`
 * option accepts it (`services.ts` builds that seat).
 */
export interface EditorBook extends Book {
  /** The canonical state: the bound view's when one is bound, else the held one. */
  readonly state: EditorState;
  /** The canonical parse, for a surface that borrows instead of analyzing. */
  structure(): DocStructure;
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
  /** Views plus windows currently holding this book; blocks `project.release`. */
  attached(): number;
  /** A non-view attachment (a `ClipWindow`, a satellite). Release to let go. */
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
  /** Publication in CodeMirror's own vocabulary, for borrowing surfaces. */
  attach(receive: Receive): () => void;
  /** This book as the port satellites and windows submit through. */
  funnel(): Funnel;
  /** Drops the state, the view binding and every subscriber. */
  close(): void;
}

export interface EditorBookOptions {
  /** The engine for this book — composition passes `galley.memoize()`. */
  readonly analyze: Analyze;
  /** Extra extensions for the canonical state (a linter, a projection). */
  readonly extensions?: Extension;
  /** When present, `apply` and refusals are noted. Absent is fine. */
  readonly observability?: ObservabilityService;
}

/**
 * The origin a view-driven transaction claims.
 *
 * CodeMirror's `userEvent` is the editor's own vocabulary ("input.type",
 * "delete.backward", "undo"), and `apply` writes ours into it as
 * `input.<origin>`. Stripping the `input.` prefix recovers the origin an
 * `apply` caller named and leaves CodeMirror's other events as they are, which
 * is what a receipt should say about a keystroke.
 */
const originOf = (tr: Transaction): Origin => {
  const event = tr.annotation(Transaction.userEvent);
  if (event === undefined) return "keyboard";
  return event.startsWith("input.") ? event.slice("input.".length) : event;
};

export const editorBook = (plain: Book, options: EditorBookOptions): EditorBook => {
  const { id, path } = plain;
  const observability = options.observability;
  const listeners = makeListeners();
  const receivers = new Set<Receive>();

  // The revision the plain Book arrived with, continued rather than restarted:
  // a Save baseline or a Recovery journal taken while the book was plain must
  // still compare against what the seat reports.
  let revision = plain.source().stamp.revision;
  // The disk form the file arrived in. CodeMirror holds canonical text only,
  // so the form travels beside the state rather than in it, and Save writes
  // the seat's bytes back the way it read them.
  const form = plain.source().form;
  let holds = 0;
  let closed = false;

  // The instrument (`core/instrument.ts`) is installed at LOWEST precedence so
  // a caller who wants the trace for itself keeps it; when they do, this book
  // still reads refusals, because the refusal slot belongs to the instrument
  // rather than to any one tracer. With no Observability the trace is still
  // assembled — `Refusal.rule` needs it — it just does not leave the process.
  let own = EditorState.create({
    doc: plain.source().text,
    extensions: [
      usfmEditorHeadless({ analyze: options.analyze }),
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

  const state = (): EditorState => (view === null ? own : view.state);

  const stamp = (): SourceStamp => ({ revision, length: state().doc.length });

  const round = (ms: number): number => Math.round(ms * 1000) / 1000;

  /**
   * One accepted edit: bump the revision, then publish — borrowing surfaces
   * first (they must map their caret through this exact `ChangeSet` before
   * anyone reads them), then the Book port's own listeners.
   */
  const accept = (tr: Transaction, before: SourceStamp, origin: Origin): Receipt => {
    revision += 1;
    const receipt: Receipt = { before, after: stamp(), origin };
    const now = state();
    // The satellites first — they must map their caret through this exact
    // `ChangeSet` before anyone reads them — then the Book port's listeners.
    // Both run INSIDE the gesture, so their cost is the gesture's cost.
    const broadcast = performance.now();
    for (const receive of Array.from(receivers)) receive(tr.changes, now);
    const satellites = performance.now();
    listeners.publish(receipt, changesOf(tr.changes));
    const published = performance.now();
    // On the gesture's own record when there is one. `book.apply` as a
    // separate note was a root of its own: a fact about a keystroke, filed
    // where nothing could see which keystroke.
    const fields = {
      "book.id": id,
      "book.origin": origin,
      "book.revision": receipt.after.revision,
      "book.revision_before": before.revision,
      "book.receivers": receivers.size,
      "book.broadcast_ms": round(satellites - broadcast),
      "book.publish_ms": round(published - satellites),
    };
    const trace = traceOf(tr.startState);
    if (trace === null) observability?.note("book.apply", "rewrote", undefined, fields);
    else trace.annotate(fields);
    return receipt;
  };

  /**
   * The refusal a rejected `apply` reports.
   *
   * The FIRST stage that refused, not the last: a change filter that vetoes a
   * range runs before the transaction rules that would have rewritten it, so
   * the first door to close is the one that decided. `reason` is that stage's
   * own words when it had any — the same detail the trace shows.
   */
  const refuse = (origin: Origin, count: number): Refusal => {
    const first = lastRefusal();
    const rule = first?.rule ?? "editor.phases";
    const fields = {
      "book.id": id,
      "book.origin": origin,
      "book.rule": rule,
      "book.changes": count,
    };
    const trace = traceOf(state());
    if (trace === null) observability?.note("book.apply", "refused", first?.detail, fields);
    else trace.annotate(fields);
    return new Refusal({
      rule,
      reason: first?.detail ?? "Refused",
      description: `${id} refused ${count} change(s) from ${origin}`,
    });
  };

  const specFor = (changes: readonly Change[], origin: Origin, trust: Trust) => {
    const annotations = [
      ...(trust.trusted ? [trusted.of(trust.by)] : []),
      // A project-wide operation is ONE undo step per book, whatever it did to
      // this book's text: `isolateHistory` stops CodeMirror from folding it
      // into the keystroke before or after it.
      ...(origin.startsWith("project.") ? [isolateHistory.of("full" as const)] : []),
    ];
    return {
      changes: changes.map((change) => ({
        from: change.from,
        to: change.to,
        insert: change.insert,
      })),
      userEvent: `input.${origin}`,
      ...(annotations.length === 0 ? {} : { annotations }),
    };
  };

  /** Runs a command (undo/redo) against whichever seat is canonical. */
  const command = (
    run: (target: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean,
  ): boolean => {
    const bound = view;
    if (bound !== null) {
      // The book's history is the book's, so undo and redo run HERE whichever
      // surface asked — the toolbar's buttons, the palette, `Mod-z` inside an
      // open note editor. When the reader is not in this view, its own
      // restored selection is not a place they are looking at, and scrolling
      // to it threw them somewhere else and destroyed the satellite they were
      // typing in (see core/scroll.ts). The edit lands either way; only the
      // page is kept still.
      if (bound.hasFocus) return run(bound);
      return withoutScrolling(() => run(bound));
    }
    // A one-slot box rather than a `let`: the command dispatches from inside a
    // callback, and an array reads back without an assertion.
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

  const book: EditorBook = {
    id,
    path,

    get state() {
      return state();
    },

    source: (): Source => ({ text: docText(state()), stamp: stamp(), form }),

    structure: () => structureAt(state()),

    apply: (changes, origin, trust = UNTRUSTED): Result.Result<Receipt, Refusal> => {
      const list = asChangeList(changes);
      const before = stamp();
      clearRefusal();
      const spec = specFor(list, origin, trust);
      const bound = view;
      if (bound !== null) {
        const doc = bound.state.doc;
        // Same phases, same publication: dispatching is how the view's own
        // keystrokes arrive, so an `apply` on a mounted book takes that path
        // rather than a second one.
        bound.dispatch(spec);
        if (bound.state.doc === doc) return Result.fail(refuse(origin, list.length));
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
      if (!tr.docChanged) return Result.fail(refuse(origin, list.length));
      return Result.succeed(accept(tr, before, origin));
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
        // Keep what the view had: unbinding is Mounted → Instantiated, and
        // closing a tab must not cost the translator an edit or the history.
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

  return book;
};

/**
 * The editor-backed Book as a `Funnel`. A thin adapter, not a second write
 * path: `submit` is `apply`, and the result is unwrapped because a satellite
 * wants the `Refusal` itself (to say which rule refused) rather than a Result
 * it must destructure.
 */
export const funnelFor = (book: EditorBook): Funnel => ({
  doc: () => book.state.doc,
  structure: () => book.structure(),
  submit: (changes, origin, trust) => {
    const result = book.apply(changes, origin, trust);
    return Result.isSuccess(result) ? result.success : result.failure;
  },
  attach: book.attach,
  undo: () => book.history()?.undo() ?? false,
  redo: () => book.history()?.redo() ?? false,
  depth: () => book.history()?.depth() ?? { undo: 0, redo: 0 },
});
