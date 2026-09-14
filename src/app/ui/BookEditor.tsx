/**
 * The one place a Solid component touches CodeMirror and a Book.
 *
 * This is the Solid/Book boundary the seams name (editor-and-save §1.5): the
 * canonical text lives in the `EditorBook`'s `EditorState`, and the shell must
 * not hold a second copy of it. So:
 *
 *  - The view is created ONCE, over `book.state`, and destroyed in
 *    `onCleanup`. Solid never re-renders it — components run once, and the
 *    document is CodeMirror's business from here down. A different book means
 *    a different component instance (the route keys on the book id).
 *  - Every transaction goes through `book.fromView`, which is where a keystroke
 *    becomes a receipt every reader sees. Binding a view that dispatched on its
 *    own would make the book's publication silently incomplete — `apply`
 *    throws rather than report a receipt nobody heard.
 *  - ONE subscription per book, here: `book.changes` writes a stamp signal (so
 *    the status bar is reactive) and hands the editor's own parse to
 *    ProjectAnalysis, so a keystroke costs no second wasm call.
 *
 * Mode and chapter are dispatched into the canonical state through a
 * compartment. Neither is a document change, so `fromView` ignores them —
 * which is exactly right: a projection is presentation and a clip is a view
 * choice, and neither is an edit.
 */

import { Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEffect, createRenderEffect, createSignal, onCleanup } from "solid-js";

import type { SourceStamp } from "../../core/source/source";
import {
  assignment,
  modeFacet,
  pickChapter,
  projectionFor,
  structureAt,
  type EditorBook,
  type ProjectionName,
  keystrokeMeter,
  recent as editorSpans,
  summary as editorSummary,
  dumpTrace,
  traces as editorTraces,
  type Measured,
} from "../../editor";
import { installEditorDevSurface } from "../../platform/observability";
import { useComposition } from "../CompositionContext";
import { useShell } from "../ProjectContext";

// Last measurements for the dev surface; one module-level ring is enough.
const keystrokes: Measured[] = [];

// The editor's own stylesheet. It ships with the editor module and is imported
// where the view mounts, so a route that never opens a book never loads it.
import "../../editor/editor.css";

export interface BookEditorProps {
  readonly book: EditorBook;
}

const cmMode = (mode: ProjectionName): "regular" | "usfm" => (mode === "usfm" ? "usfm" : "regular");

interface Bound {
  readonly view: EditorView;
  readonly projection: Compartment;
}

export function BookEditor(props: BookEditorProps) {
  const shell = useShell();
  const observability = useComposition().observability;
  const [stamp, setStamp] = createSignal<SourceStamp | undefined>(undefined, { name: "stamp" });
  const [bound, setBound] = createSignal<Bound | undefined>(undefined, { name: "boundView" });
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "editorHost",
  });

  // An effect, not a render effect: the view measures itself, so it must be
  // constructed after its parent is in the document.
  createEffect(
    () => host(),
    (parent) => {
      if (parent === undefined) return;
      const book = props.book;

      const projection = new Compartment();
      let view: EditorView | undefined;
      view = new EditorView({
        state: book.state,
        parent,
        dispatchTransactions: (transactions) => {
          if (view !== undefined) book.fromView(view, transactions);
        },
      });
      const created = view;
      const unbind = book.bindView(created);
      // The mountable half of the editor is added here rather than baked into
      // the seat, because the canonical state must also work headless.
      // The keystroke meter closes one gesture per DOM event and reports the
      // wall time from event to last update, the analyzes it cost, and the
      // per-span totals. The ring gets one bounded note per gesture; the dev
      // surface keeps the last fifty measurements whole.
      const meter = keystrokeMeter((measured) => {
        const totals = Array.from(measured.totals, ([name, t]) => `${name}=${t.ms.toFixed(1)}`);
        observability.note(
          "keystroke",
          "ready",
          `${measured.ms.toFixed(1)}ms analyzes=${measured.analyzes} ${totals.join(" ")}`,
          book.id,
        );
        keystrokes.push(measured);
        if (keystrokes.length > 50) keystrokes.shift();
      });
      installEditorDevSurface({
        keystrokes: () => keystrokes,
        spans: editorSpans,
        summary: editorSummary,
        // The pipeline instrument: which stages each recent transaction flowed
        // through and what each decided. `trace()` prints one of them.
        traces: editorTraces,
        trace: (at) => {
          const held = editorTraces();
          const one = held[at === undefined ? held.length - 1 : at];
          return one === undefined ? "no trace recorded" : dumpTrace(one);
        },
      });
      created.dispatch({
        effects: StateEffect.appendConfig.of([projection.of([]), meter.extension]),
      });

      const supply = (): void => {
        const analysis = structureAt(book.state).analysis;
        if (analysis !== null) shell.services.projectAnalysis.supply(book.id, analysis);
      };
      supply();

      const unsubscribe = book.changes((receipt) => {
        setStamp(receipt.after);
        supply();
        shell.bump();
      });

      setBound({ view: created, projection });

      onCleanup(() => {
        unsubscribe();
        unbind();
        created.destroy();
        setBound(undefined);
      });
    },
  );

  // The view choices: which classes paint how, and which chapter is editable.
  createRenderEffect(
    () => ({ held: bound(), mode: shell.mode(), chapter: shell.chapter() }),
    ({ held, mode, chapter }) => {
      if (held === undefined) return;
      // The mode class rides the compartment as an editor attribute, not a
      // hand-added class: CodeMirror rewrites `view.dom`'s class attribute from
      // its facets whenever focus changes, and a class it did not put there is
      // wiped on the first click into the text.
      held.view.dispatch({
        effects: held.projection.reconfigure([
          assignment.of(projectionFor(mode)),
          modeFacet.of(cmMode(mode)),
          EditorView.editorAttributes.of({ class: `cm-mode-${cmMode(mode)}` }),
        ]),
      });
      held.view.dispatch(pickChapter(held.view.state, chapter));
    },
  );

  // An aimed open (a finding, a search hit, the palette) scrolls to its offset
  // once the view is bound. Runs after the clip above so the target is visible
  // whether the reader prefers the whole book or one chapter.
  createEffect(
    () => ({ held: bound(), aimed: shell.reveal() }),
    ({ held, aimed }) => {
      if (held === undefined || aimed === undefined || aimed.bookId !== props.book.id) return;
      const at = Math.min(aimed.from, held.view.state.doc.length);
      held.view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "center" }) });
    },
  );

  return (
    <div
      class="editor-host cm-host"
      data-mode={shell.mode()}
      data-revision={(stamp() ?? props.book.source().stamp).revision}
      ref={setHost}
    />
  );
}
