/**
 * The one place a Solid component touches CodeMirror and a Book.
 *
 * This is the Solid/Book boundary the seams name (editor-and-save §1.5): the
 * canonical text lives in the `EditorBook`'s `EditorState`, and the shell must
 * not hold a second copy of it. So:
 *
 *  - The view is created ONCE, over `book.state`, and destroyed in
 *    the mount effect's returned cleanup. Solid never re-renders it — a
 *    component runs once, and the
 *    document is CodeMirror's business from here down. A different book means
 *    a different component instance (the route keys on the book id).
 *  - Every transaction goes through `book.fromView`, which is where a keystroke
 *    becomes a receipt every reader sees. Binding a view that dispatched on its
 *    own would make the book's publication silently incomplete — `apply`
 *    throws rather than report a receipt nobody heard.
 *  - ONE subscription per book, here: `book.changes` writes a stamp signal (so
 *    the status bar is reactive) and hands the editor's own parse to
 *    ProjectAnalysis, so a keystroke costs no second wasm call.
 *  - The corpus half of sink 1 flows the other way through the same seam. The
 *    editor cannot compute a Sous finding, so `ProjectAnalysis.watch()` — which
 *    fires once per scheduler pass, after the publication — is the cue to push
 *    the book's fresh corpus findings into the editor's `sousField`. Off the
 *    keystroke path by construction: a keystroke arms the scheduler and clears
 *    the field; the refill arrives when the corpus publishes.
 *
 * Mode and chapter are dispatched into the canonical state through a
 * compartment. Neither is a document change, so `fromView` ignores them —
 * which is exactly right: a projection is presentation and a clip is a view
 * choice, and neither is an edit.
 */

import { Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useNavigate } from "@tanstack/solid-router";
import { Effect, Fiber, Stream } from "effect";
import { createEffect, createRenderEffect, createSignal, untrack } from "solid-js";

import { stale } from "../../core/findings/finding";
import type { SourceStamp } from "../../core/source/source";
import {
  assignment,
  flash,
  flashing,
  frontMatterCard,
  showCorpusFindings,
  type CorpusFinding,
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
  noteBookIs,
  watchLocation,
} from "../../editor";
import { installEditorDevSurface } from "../../platform/observability";
import { useComposition } from "../CompositionContext";
import { useShell } from "../ProjectContext";
import { LocationBar } from "./workspace/LocationBar";

// Last measurements for the dev surface; one module-level ring is enough.
const keystrokes: Measured[] = [];

/**
 * Which books have already had the mountable half of the editor appended to
 * their canonical state, and the projection compartment that went in with it.
 *
 * Module-level and weak, because the fact being remembered is a fact about the
 * BOOK and not about this component: `appendConfig` dispatched through a bound
 * view lands in the Book's state and stays there after the view is destroyed.
 */
const mountedConfig = new WeakMap<EditorBook, Compartment>();

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
  // The book this instance is for, read once — see the mount effect below.
  const bookId = untrack(() => props.book.id);
  const navigate = useNavigate();
  const go = (to: string): void => {
    // SAFETY: the project path is built at runtime from a root, which no route
    // literal union can spell. An unresolvable path goes through the router's
    // own not-found boundary, never a crash — the same trade every other
    // navigation in the shell makes.
    void navigate({ to: to as never });
  };
  const observability = useComposition().observability;
  const [stamp, setStamp] = createSignal<SourceStamp | undefined>(undefined, { name: "stamp" });
  const [bound, setBound] = createSignal<Bound | undefined>(undefined, { name: "boundView" });
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "editorHost",
  });
  // Which chapter is at the TOP of the viewport. A fact about the scroll
  // position, not about the document, so it lives here beside the view rather
  // than in the shell: two views over one book can honestly disagree.
  const [atTop, setAtTop] = createSignal<number | undefined>(undefined, { name: "chapterAtTop" });

  // An effect, not a render effect: the view measures itself, so it must be
  // constructed after its parent is in the document.
  createEffect(
    () => host(),
    (parent) => {
      if (parent === undefined) return;
      // A deliberate one-time read, said so the runtime believes it: an
      // effect's callback is an untracked scope in Solid 2, and a bare
      // `props.book` there is a read it warns about. This component is keyed on
      // the book id (see the route), so a different book is a different
      // instance and this prop cannot change under a mounted view.
      const book = untrack(() => props.book);

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
      // The note editor mounts a satellite over this book, and a satellite is
      // built from a `Funnel` — which comes from the Book, not from the view.
      // This is the one place that knows both.
      const unname = noteBookIs(created, book);
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
      // The mountable half of the editor, appended ONCE PER BOOK.
      //
      // Once, because `appendConfig` goes through the view and the view is
      // bound to the Book — so the extension lands in the Book's CANONICAL
      // state and outlives this component. Mounting a second view over the
      // same book (leave the route, come back) used to append the whole set
      // again: two `editorAttributes` writing `cm-mode-regular`, two keystroke
      // meters, two notes per keypress, two front matter cards. The compartment
      // is remembered with it, because a compartment that is not in the config
      // is a reconfigure that does nothing.
      //
      // It is added here rather than baked into the seat because the canonical
      // state must also work headless: the meter and the front matter card are
      // DOM surfaces, and a Book in Node has no DOM.
      let projection = mountedConfig.get(book);
      if (projection === undefined) {
        projection = new Compartment();
        mountedConfig.set(book, projection);
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
        created.dispatch({
          effects: StateEffect.appendConfig.of([
            projection.of([]),
            meter.extension,
            flashing(),
            frontMatterCard(),
          ]),
        });
      }

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

      // The corpus half of sink 1. `crossBook()` is the whole project's Sous
      // findings; this book's share of them is shown inline, and only while
      // the publication still describes the text the reader is looking at —
      // `stale` is the one freshness question, and a stale finding is dropped
      // silently rather than shifted onto an offset nobody measured.
      const corpus = (): void => {
        const list: CorpusFinding[] = [];
        for (const finding of shell.services.projectAnalysis.crossBook())
          if (finding.bookId === book.id && !stale(finding, book)) list.push(finding);
        showCorpusFindings(created, list);
        // Counts and ids only — a finding's message quotes the document and
        // never reaches the ring (editor-and-save §2, sink 4).
        observability.note(
          "editor.sous",
          "ready",
          `${book.id} n=${list.length} r${book.source().stamp.revision}`,
          book.id,
        );
      };
      corpus();
      // One pass of the analysis scheduler publishes the corpus once and then
      // reports every book it refreshed, so any event means a new snapshot —
      // including one provoked by another book, which is how a cross-book
      // finding about this one appears.
      const watching = shell.services.runtime.runFork(
        Stream.runForEach(shell.services.projectAnalysis.watch(), () => Effect.sync(corpus)),
      );

      // The location bar's reading. One passive scroll listener, coalesced into
      // an animation frame by the recipe.
      const unwatch = watchLocation(created, (where) => {
        setAtTop(where === null ? undefined : where.ordinal);
      });

      setBound({ view: created, projection });

      // RETURNED, not `onCleanup`. A Solid 2 effect's cleanup is its return
      // value; `onCleanup` inside an effect callback is called outside any
      // owner and never runs at all (NO_OWNER_CLEANUP, which the dev build says
      // out loud). Everything below was leaking: the view was never destroyed,
      // the book stayed bound, and the analysis fiber outlived the screen.
      return () => {
        unwatch();
        unname();
        Effect.runFork(Fiber.interrupt(watching));
        unsubscribe();
        unbind();
        created.destroy();
        setBound(undefined);
      };
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
  //
  // And it FLASHES. The scroll alone is not an answer when the target is
  // already on screen — which is exactly the case when the reader clicks a
  // second hit in the book they are already in, and the page not moving reads
  // as the click not landing.
  createEffect(
    () => ({ held: bound(), aimed: shell.reveal() }),
    ({ held, aimed }) => {
      if (held === undefined || aimed === undefined || aimed.bookId !== bookId) return;
      const length = held.view.state.doc.length;
      const at = Math.min(aimed.from, length);
      const end = Math.min(aimed.to ?? at, length);
      // A finding or a search hit is a point in the middle of a page, so it is
      // centred; a CHAPTER is the first line you read, so it goes to the top
      // with the rest of the book below it.
      held.view.dispatch({
        effects: EditorView.scrollIntoView(at, { y: aimed.at === "top" ? "start" : "center" }),
      });
      const cancel = flash(held.view, { from: at, to: end });
      return cancel;
    },
  );

  // The card is the frame; the location bar is pinned inside it and the
  // CodeMirror host scrolls under it. `.editor-host` is the card (app.css) and
  // `.cm-host` is what CodeMirror fills, which is why they are two elements now
  // and were one before.
  return (
    <div
      class="editor-host shadow-small"
      data-testid="editor-card"
      data-mode={shell.mode()}
      data-revision={(stamp() ?? props.book.source().stamp).revision}
    >
      <LocationBar ordinal={atTop()} go={go} />
      <div class="cm-host" data-testid="editor-host" ref={setHost} />
    </div>
  );
}
