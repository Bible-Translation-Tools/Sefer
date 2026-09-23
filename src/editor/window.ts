/**
 * `ClipWindow` — a second editable surface over the whole of one book, clipped
 * to one chapter (seams §3.9; editor-and-save §1.3–§1.4).
 *
 * A window is what a search result card and a second pane are made of. It
 * holds a headless state with the SAME text as the canonical book, clipped by
 * the pick effect to the chapter containing a position. It is a reader that
 * may write, and its whole discipline is the round trip: a local edit is
 * turned into changes, submitted through the book's `apply`, and applied to
 * the window only when it comes back with the rest of the readers. The window
 * keeps its own caret and its own clip across that turn; it never keeps its
 * own text.
 *
 * Windows BORROW: the state lends `borrowedStructure` from the book, so ten
 * open cards over one book cost zero extra parses as long as their text
 * matches the canonical exactly (`describesExactly`). The one turn a window
 * pays for a parse of its own is between its submit and the answer.
 */

import {
  EditorState,
  Transaction,
  type ChangeSet,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Result } from "effect";

import type { Origin, Trust } from "../core/book/book";
import type { EditorBook } from "./book";
import type { Analyze } from "./core/analyzer";
import { analyzer } from "./core/analyzer";
import { setPick, editableClipAt, type ClipRange } from "./core/clip";
import { usfmEditorHeadless } from "./core/compose";
import { borrowedStructure } from "./core/docStructure";
import { trusted } from "./core/kernel";
import { changesOf, fromCanonical } from "./funnel";

interface WindowOptions {
  /** The engine for the one turn the window is out of step with the book. */
  readonly analyze: Analyze;
  readonly extensions?: Extension;
  /** Windows are a UI surface, so untrusted by default — the rules apply. */
  readonly trust?: Trust;
  /** Bind at construction, for a view that already exists. */
  readonly view?: EditorView;
}

/**
 * The canonical text arriving back from the book. `filter: false` skips the
 * phases — they already ran, on the canonical state — and the annotations say
 * so, which is what stops `fromView` from resubmitting it in a loop.
 */
const RETURNED: TransactionSpec = {
  annotations: [
    fromCanonical.of(true),
    trusted.of("canonical"),
    Transaction.addToHistory.of(false),
  ],
  filter: false,
};

interface ClipWindow {
  /** The window's own state: the bound view's when bound, else the held one. */
  readonly state: EditorState;
  /** The editable extent of the picked chapter, or null when nothing is picked. */
  readonly clip: ClipRange;
  bindView(view: EditorView): () => void;
  /** Told when the canonical text arrived and the window's state moved. */
  onChange(fn: (state: EditorState) => void): () => void;
  /** Offers changes to the book. `false` when the phases refused them. */
  submit(
    changes: readonly { from: number; to: number; insert: string }[],
    origin?: Origin,
  ): boolean;
  /** The bound view's dispatch hook: forward doc changes, keep the caret. */
  fromView(view: EditorView, trs: readonly Transaction[]): void;
  close(): void;
}

/**
 * Opens a window on `book`, clipped to the chapter containing `at`.
 *
 * `null` when `at` is not a position in the book's text — a stale search hit
 * is the ordinary case, and a window over a position that no longer exists
 * would clip to nothing and read as an empty chapter.
 */
const openWindow = (book: EditorBook, at: number, options: WindowOptions): ClipWindow | null => {
  const canonical = book.state;
  if (at < 0 || at > canonical.doc.length) return null;

  const base = EditorState.create({
    doc: canonical.doc,
    extensions: [
      analyzer.of(options.analyze),
      borrowedStructure.of(() => book.structure()),
      usfmEditorHeadless({ analyze: options.analyze }),
      options.extensions ?? [],
    ],
  });

  let own = base.update({ effects: setPick.of(at) }).state;
  let view: EditorView | null = options.view ?? null;
  let closed = false;
  const listeners = new Set<(state: EditorState) => void>();
  const release = book.hold();

  const state = (): EditorState => (view === null ? own : view.state);

  const receive = (changes: ChangeSet): void => {
    if (closed) return;
    const bound = view;
    if (bound !== null) bound.dispatch({ changes, ...RETURNED });
    else own = own.update({ changes, ...RETURNED }).state;
    for (const fn of Array.from(listeners)) fn(state());
  };

  const detach = book.attach(receive);

  const offer = (
    changes: readonly { from: number; to: number; insert: string }[],
    origin: Origin,
  ) => Result.isSuccess(book.apply(changes, origin, options.trust));

  const window: ClipWindow = {
    get state() {
      return state();
    },

    get clip() {
      return editableClipAt(state());
    },

    bindView: (bound) => {
      view = bound;
      return () => {
        if (view !== bound) return;
        own = bound.state;
        view = null;
      };
    },

    onChange: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    submit: (changes, origin = "window") => {
      if (closed) return false;
      // Run the changes through the window's own state first: it is the same
      // phase set, so a change the rules will refuse is refused here without
      // disturbing the canonical state, and a change that maps to nothing
      // (the window's clip already says no) never reaches the book.
      const tr = state().update({ changes, userEvent: `input.${origin}` });
      if (!tr.docChanged) return false;
      return offer(changesOf(tr.changes), origin);
    },

    fromView: (bound, trs) => {
      for (const tr of trs) {
        if (!tr.docChanged || tr.annotation(fromCanonical) === true) {
          bound.update([tr]);
          continue;
        }
        // The edit does NOT land locally here: it lands when the book
        // publishes it back through `receive`. Only the caret is kept, so the
        // round trip is invisible to the typist.
        const accepted = offer(changesOf(tr.changes), "window");
        if (accepted && tr.selection !== undefined)
          bound.dispatch({ selection: tr.newSelection, ...RETURNED });
      }
    },

    close: () => {
      if (closed) return;
      closed = true;
      detach();
      release();
      listeners.clear();
      view = null;
    },
  };

  return window;
};
