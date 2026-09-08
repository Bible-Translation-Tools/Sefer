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
} from "../../editor";
import { useShell } from "../ProjectContext";

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
      created.dom.classList.add("cm-mode-regular");
      // The mountable half of the editor is added here rather than baked into
      // the seat, because the canonical state must also work headless.
      created.dispatch({
        effects: StateEffect.appendConfig.of(projection.of([])),
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
      held.view.dispatch({
        effects: held.projection.reconfigure([
          assignment.of(projectionFor(mode)),
          modeFacet.of(cmMode(mode)),
        ]),
      });
      held.view.dom.classList.toggle("cm-mode-usfm", cmMode(mode) === "usfm");
      held.view.dom.classList.toggle("cm-mode-regular", cmMode(mode) === "regular");
      held.view.dispatch(pickChapter(held.view.state, chapter));
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
