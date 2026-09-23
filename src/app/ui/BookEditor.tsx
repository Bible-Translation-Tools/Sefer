/**
 * The one place a Solid component touches CodeMirror and a Book.
 *
 * This is the Solid/Book boundary (`documentation/architecture/shell.md`): the
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

import { Compartment, StateEffect, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Effect, Fiber, Stream } from "effect";
import { createEffect, createRenderEffect, createSignal, untrack } from "solid-js";

import { stale } from "#core/findings/finding";
import type { SourceStamp } from "#core/source/source";
import {
  annotateOpen,
  annotateRepaint,
  gestureTrace,
  assignment,
  annotateEmptyBlocks,
  blockNamer,
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
  noteBookIs,
  pairingHere,
  showBlockPairs,
  showEmptyBlocks,
  watchLocation,
} from "#editor/index";

import { textDirection } from "../language";
import { useShell } from "../ProjectContext";
import { shellKeys } from "../settings";
import { nameBlock } from "./workspace/blockNames";
import { LocationBar } from "./workspace/LocationBar";
import { metadataOf } from "./workspace/project";

// Last measurements for the dev surface; one module-level ring is enough.

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
import "#editor/editor.css";

export interface BookEditorProps {
  readonly book: EditorBook;
}

/**
 * The offset a remembered place names now, or `undefined`.
 *
 * A LADDER, because the document may have moved while the reader was away —
 * they may have been in Find for the express purpose of changing it:
 *
 *   1. the exact offset, when the document is the same length as when it was
 *      taken (see `LastLocation.place` for why length and not a hash);
 *   2. the VERSE, by its number, scoped to its chapter;
 *   3. the CHAPTER, by `\c`'s own label;
 *   4. nothing, and stay at the top.
 *
 * Every rung below the first is looked up by what the document SAYS rather
 * than by an ordinal or an offset, so a book that gained a `\toc` line still
 * resolves and a verse that was deleted falls to its chapter instead of
 * landing in whatever now occupies its coordinates.
 */
const placeOf = (
  state: EditorState,
  place: {
    readonly chapter: string;
    readonly verse?: string;
    readonly offset?: number;
    readonly hash?: string;
    readonly length?: number;
  },
): number | undefined => {
  const structureNow = structureAt(state);
  // The hash when BOTH sides have one — a fresh view has not parsed yet, so
  // `analysis` is routinely null exactly here (see `LastLocation.place`) — and
  // the length otherwise. Same length is weaker than same hash: an edit that
  // swapped one word for another of equal width would pass it, and the cost of
  // being wrong is an offset a few characters stale, which at scroll
  // granularity nobody can see. A different length is proof of change either
  // way, and drops to the verse.
  const hash = structureNow.analysis?.sourceHash;
  const unmoved =
    hash !== undefined && place.hash !== undefined
      ? String(hash) === place.hash
      : place.length === state.doc.length;
  if (place.offset !== undefined && unmoved) return Math.min(place.offset, state.doc.length);
  const chapter = structureNow.chapters.find((row) => row.label === place.chapter);
  if (chapter === undefined) return undefined;
  if (place.verse === undefined) return chapter.from;
  // Scoped to the chapter: verse numbers repeat, and `10` alone names sixty
  // places in a book.
  const verse = structureNow.verses.find(
    (row) =>
      row.markerFrom >= chapter.from && row.markerFrom < chapter.to && row.num === place.verse,
  );
  return verse?.markerFrom ?? chapter.from;
};

const cmMode = (mode: ProjectionName): "regular" | "usfm" => (mode === "usfm" ? "usfm" : "regular");

interface Bound {
  readonly view: EditorView;
  readonly projection: Compartment;
}

export function BookEditor(props: BookEditorProps) {
  const shell = useShell();
  /** Which way this project's scripture runs; see the host element below. */
  const direction = (): "ltr" | "rtl" => textDirection(metadataOf(shell.project()));
  // The book this instance is for, read once — see the mount effect below.
  const bookId = untrack(() => props.book.id);
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
      // READ FIRST, before the view exists and before `watchLocation` below
      // starts reporting. That watcher reads its view's position the moment it
      // attaches, and a freshly built view is at the top of the book — so
      // taking this any later reads a value the mount has already overwritten
      // with "chapter 1, offset 0". Which is precisely what it did.
      const remembered = untrack(() => {
        if (shell.reveal()?.bookId === bookId) return undefined;
        const root = shell.project()?.root;
        const held = root === undefined ? undefined : shell.lastLocation(root);
        return held?.bookId === bookId ? held.place : undefined;
      });
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
      // The mountable half of the editor, appended ONCE PER BOOK.
      //
      // Once, because `appendConfig` goes through the view and the view is
      // bound to the Book — so the extension lands in the Book's CANONICAL
      // state and outlives this component. Mounting a second view over the
      // same book (leave the route, come back) would otherwise append the
      // whole set again: two `editorAttributes` writing `cm-mode-regular`, two
      // keystroke meters, two notes per keypress, two front matter cards. The compartment
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
        // JS work, the time to paint, the analyzes it cost, and the per-span
        // totals — which sum to the JS work. The line itself is the meter's
        // (`Measured.note`), so the format lives beside the arithmetic that
        // makes it add up. The ring gets one bounded note per gesture; the dev
        // surface keeps the last fifty measurements whole.
        const meter = keystrokeMeter((measured) => {
          // Onto the gesture's own record. The meter measures THROUGH the
          // paint, which lands after the transaction's rules are done but
          // before the next transaction opens, so the gesture is still the one
          // that is open — and `annotateOpen` says so rather than assuming it.
          // A `keystroke` note of its own was a root beside the mutation it
          // described, which is the shape this whole pass is removing.
          //
          // Both are measured from the DOM EVENT, where the gesture's own span
          // starts at the first phase rule a fraction of a millisecond later —
          // so `to_paint_ms` can read slightly longer than the span that
          // carries it. Named for their windows rather than left to look like
          // a contradiction.
          //
          // `to_paint_ms` is also mostly not work: a keystroke that lands
          // mid-frame waits for the next vsync, so ~16ms at 60Hz is the floor,
          // not a cost. `js_ms` is the half we can do anything about.
          //
          // `to_paint_source` says which instrument answered. `event` is the
          // browser's own Event Timing number and is what to trust; `frame` is
          // the requestAnimationFrame inference, which reads up to a frame
          // high because the timeout witnessing the paint can land after it.
          // Comparing the two across records without reading this field is
          // how "a 3ms keystroke took 33ms" gets believed. Measured on en_ulb,
          // same typing, same machine: `event` says 16ms — one frame, the
          // vsync floor — where `frame` says 29 to 33.
          //
          // The SPAN's own duration is not a third answer. The gesture closes
          // when its measurement lands, so `editor.mutation`'s ms is "until we
          // were told", which on the event path includes the observer's own
          // latency. `editor.to_paint_ms` is the number to read.
          const onGesture = annotateOpen({
            "editor.js_ms": measured.gesture,
            "editor.analyzes": measured.analyzes,
            "editor.unaccounted_ms": measured.other,
            ...(measured.render === null
              ? {}
              : {
                  "editor.to_paint_ms": measured.render,
                  "editor.to_paint_source": measured.renderSource ?? "frame",
                }),
          });
          if (!onGesture)
            // No gesture was open — the meter measured a repaint nobody
            // typed for, and it belongs to that rather than to a keystroke.
            annotateRepaint({
              "editor.js_ms": measured.gesture,
              "book.id": book.id,
              ...(measured.render === null
                ? {}
                : {
                    "editor.to_paint_ms": measured.render,
                    "editor.to_paint_source": measured.renderSource ?? "frame",
                  }),
            });
        });
        created.dispatch({
          effects: StateEffect.appendConfig.of([
            projection.of([]),
            meter.extension,
            flashing(),
            // Where the caret is, published to the shell.
            //
            // `selectionSet` and not every update: a document change that does
            // not move the caret is not news to anybody reading this, and an
            // update fires for scrolls, measurements and reconfigures too. The
            // head rather than the anchor, because a reader dragging a
            // selection is asking about the end they are dragging.
            //
            // The write is unconditional and the consumers derive — see
            // `Shell.noteCaret`. Comparing here would mean this listener
            // holding a copy of the last offset, which is a second record of
            // the thing the signal already is.
            EditorView.updateListener.of((update) => {
              if (update.selectionSet) shell.noteCaret(update.state.selection.main.head);
            }),
            frontMatterCard(),
            // Blocks with no words, named where the words go. The initial
            // value is the reader's setting; the fiber below follows it, so
            // turning it off moves the page rather than the next reload.
            blockNamer.of(nameBlock),
            annotateEmptyBlocks(
              shell.services.settings.get(
                shellKeys(shell.services.settings).annotateEmptyParagraphs,
              ),
            ),
            // The editor's half of the block pairing. It marks the block the
            // caret is in; the panes beside it mark the block at the same
            // address, and the CORRESPONDENCE is the pair of marks. One
            // without the other asserts something the reader cannot check.
            pairingHere(shell.services.settings.get(shellKeys(shell.services.settings).pairBlocks)),
          ]),
        });
      }

      const supply = (): void => {
        const analysis = structureAt(book.state).analysis;
        // The gesture's trace goes with it: the pass this arms is debounced,
        // so it will carry `op.cause` rather than being a child of any one
        // keystroke. Called inside `book.changes`, which runs inside the
        // gesture, so the trace is the right one.
        if (analysis !== null)
          shell.services.projectAnalysis.supply(book.id, analysis, gestureTrace());
      };
      supply();

      const unsubscribe = book.changes((receipt) => {
        setStamp(receipt.after);
        supply();
        // The receipt names ONE book, so this says so. It is the difference
        // between a keystroke re-examining this book's save state and a
        // keystroke re-examining every book in the project.
        shell.changed({ kind: "book.apply", books: [book.id] });
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
        // never reaches the ring.
        //
        // On the REPAINT this provokes, not a record of its own. A Publication
        // fans out to every open book, and what showing findings costs is the
        // repaint — one record per book per publication would be noise about
        // one fact.
        annotateRepaint({
          "findings.shown": list.length,
          "book.id": book.id,
          "book.revision": book.source().stamp.revision,
        });
      };
      corpus();
      // One pass of the analysis scheduler publishes the corpus once and then
      // reports every book it refreshed, so any event means a new snapshot —
      // including one provoked by another book, which is how a cross-book
      // finding about this one appears.
      const watching = shell.services.runtime.runFork(
        Stream.runForEach(shell.services.projectAnalysis.watch(), () => Effect.sync(corpus)),
      );

      // `editor.annotateEmptyParagraphs`, live. One effect on a mounted view
      // rather than a compartment reconfigure: it is one boolean, and the
      // recipe holds it in a state field for exactly this.
      const ghostKey = shellKeys(shell.services.settings).annotateEmptyParagraphs;
      const ghosting = shell.services.runtime.runFork(
        Stream.runForEach(shell.services.settings.changes(ghostKey), (on) =>
          Effect.sync(() => {
            showEmptyBlocks(created, on);
          }),
        ),
      );

      // `editor.pairBlocks`, live — the same shape the ghost's fiber has, and
      // the panes run their own copy of it, so turning the setting off clears
      // both sides without either knowing about the other.
      const pairKey = shellKeys(shell.services.settings).pairBlocks;
      const pairing = shell.services.runtime.runFork(
        Stream.runForEach(shell.services.settings.changes(pairKey), (on) =>
          Effect.sync(() => {
            showBlockPairs(created, on);
          }),
        ),
      );

      // The location bar's reading. One passive scroll listener, coalesced into
      // an animation frame by the recipe.
      const unwatch = watchLocation(created, (where) => {
        setAtTop(where === null ? undefined : where.ordinal);
        // And it is written down. A book opens WHOLE, so the clip alone said
        // nothing about where in it the reader had got to, and reopening a
        // project landed on the top of the right book. This is the only place
        // that knows the answer.
        if (where !== null)
          shell.noteChapterAtTop(where.ordinal, {
            // The chapter the TOP is in, not the one filling the view — the
            // place and the crumb are different questions (see `Where`).
            chapter: where.topChapter ?? where.label,
            offset: where.top,
            length: where.length,
            ...(where.hash === undefined ? {} : { hash: where.hash }),
            ...(where.verse === undefined ? {} : { verse: where.verse }),
          });
      });

      // Where the reader had got to, put back — from the value captured at
      // the top of this effect, for the reason stated there.
      //
      // Resolved as a REFERENCE, down a ladder, because the document may have
      // moved while the reader was away — they may have been in Find for the
      // express purpose of changing it. See `placeOf`.
      //
      // It yields to `reveal`. A search hit or a finding is an explicit "take
      // me here", and restoring a remembered place over the top of one would
      // be answering a question nobody asked. The reveal effect below does the
      // moving in that case.
      const resume = remembered === undefined ? undefined : placeOf(created.state, remembered);
      if (resume !== undefined && resume > 0) {
        // The CARET goes with the scroll, and that is not a flourish.
        //
        // A fresh view puts the caret at offset 0. Restore the scroll without
        // it and the reader is looking at chapter 18 with the cursor in the
        // front matter — so the first thing they type lands at the top of the
        // book, and anything that follows the caret has nothing to say. The
        // block pairing showed that plainly: the setting was on, the panes
        // were bound, and nothing was marked until you clicked, which reads as
        // the feature being broken rather than as the caret being elsewhere.
        created.dispatch({
          selection: { anchor: resume },
          effects: EditorView.scrollIntoView(resume, { y: "start" }),
        });
        // TWICE, a frame apart. CodeMirror ESTIMATES the height of content it
        // has not rendered, so a jump deep into a book lands approximately —
        // measured at ~1,300px out, a screenful, in Genesis. The first scroll
        // brings the region into the render window and the real heights are
        // measured; the second lands on them. Without it the reader comes back
        // near where they were, which is the kind of nearly-right that reads
        // as a bug.
        requestAnimationFrame(() => {
          if (created.dom.isConnected)
            created.dispatch({ effects: EditorView.scrollIntoView(resume, { y: "start" }) });
        });
      }

      setBound({ view: created, projection });

      // RETURNED, not `onCleanup`. A Solid 2 effect's cleanup is its return
      // value; `onCleanup` inside an effect callback is called outside any
      // owner and never runs at all (NO_OWNER_CLEANUP, which the dev build says
      // out loud). Everything below was leaking: the view was never destroyed,
      // the book stayed bound, and the analysis fiber outlived the screen.
      return () => {
        unwatch();
        // No editor, no caret. Left set, it would point into a document that
        // is gone and every pane beside it would keep a stale highlight.
        shell.noteCaret(undefined);
        Effect.runFork(Fiber.interrupt(ghosting));
        Effect.runFork(Fiber.interrupt(pairing));
        unname();
        Effect.runFork(Fiber.interrupt(watching));
        unsubscribe();
        unbind();
        created.destroy();
        setBound(undefined);
      };
    },
  );

  /**
   * The mode the view is currently configured for, so a flip can be told from
   * a first bind or a clip. Not a signal: nothing renders from it.
   */
  let showing: ProjectionName | undefined;

  /** The document position sitting at the top of the viewport, right now. */
  const topOfViewport = (view: EditorView): number | undefined => {
    const box = view.scrollDOM.getBoundingClientRect();
    // A few pixels in, so the probe lands inside the first visible line rather
    // than on the boundary above it.
    return view.posAtCoords({ x: box.left + 4, y: box.top + 4 }) ?? undefined;
  };

  // The view choices: which classes paint how, and which chapter is editable.
  createRenderEffect(
    () => ({ held: bound(), mode: shell.mode(), chapter: shell.chapter() }),
    ({ held, mode, chapter }) => {
      if (held === undefined) return;
      /**
       * Flipping Regular/USFM must not move the reader.
       *
       * Both modes are the SAME DOCUMENT — Regular paints over markup rather
       * than removing it — so an offset means the same verse in both, and the
       * selection survives the reconfigure for free. What does not survive is
       * the SCROLL: hidden markup collapses lines, so the same offset sits at
       * a different height and the page appears to jump somewhere else in the
       * book. Checking your work in the other mode is the whole reason to
       * flip, and landing three chapters away defeats it.
       *
       * Only on a flip. This effect also runs on a CLIP, where re-anchoring
       * would fight the deliberate jump the reader just asked for.
       */
      const flipped = showing !== undefined && showing !== mode;
      showing = mode;
      const anchor = flipped ? topOfViewport(held.view) : undefined;
      // The mode class rides the compartment as an editor attribute, not a
      // hand-added class: CodeMirror rewrites `view.dom`'s class attribute from
      // its facets whenever focus changes, and a class it did not put there is
      // wiped on the first click into the text.
      held.view.dispatch({
        effects: [
          held.projection.reconfigure([
            assignment.of(projectionFor(mode)),
            modeFacet.of(cmMode(mode)),
            EditorView.editorAttributes.of({ class: `cm-mode-${cmMode(mode)}` }),
          ]),
          // In the SAME transaction as the reconfigure, not a second one after
          // it. A separate dispatch measures the old layout — the decorations
          // have changed but the heights have not been recomputed — so the
          // scroll lands where the anchor used to be and the reader is thrown
          // to the top of the book. One transaction lets CodeMirror apply the
          // configuration and honour the scroll request in a single measure.
          ...(anchor === undefined ? [] : [EditorView.scrollIntoView(anchor, { y: "start" })]),
        ],
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
      <LocationBar ordinal={atTop()} />
      {/* The PROJECT's direction, not the application's. A translator working
          in Arabic reads Sefer's own chrome in whatever interface language
          they chose and their scripture right-to-left; the two are separate
          settings and this is the text one. It rides the host element because
          CodeMirror reads `direction` off its computed style rather than from
          a facet, so the browser's own bidi handling does the work. */}
      <div class="cm-host" dir={direction()} data-testid="editor-host" ref={setHost} />
    </div>
  );
}
