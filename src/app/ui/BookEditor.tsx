/**
 * The one place a Solid component holds the book editor and a Book.
 *
 * This is the Solid/Book boundary (`documentation/architecture/shell.md`): the
 * canonical text lives in the `EditorBook`, and the shell must not hold a
 * second copy of it. So:
 *
 *  - The editor is mounted ONCE (`mountBookEditor`, which owns everything
 *    CodeMirror-shaped about showing a book) and destroyed in the mount
 *    effect's returned cleanup. A different book means a different component
 *    instance (the route keys on the book id).
 *  - ONE subscription per book, here: `book.changes` writes a stamp signal (so
 *    the status bar is reactive) and hands the editor's own parse to
 *    ProjectAnalysis, so a keystroke costs no second wasm call.
 *  - The corpus half of sink 1 flows the other way through the same seam. The
 *    editor cannot compute a Sous finding, so `ProjectAnalysis.watch()` — which
 *    fires once per scheduler pass, after the publication — is the cue to push
 *    the book's fresh corpus findings into the editor. Off the keystroke path
 *    by construction: a keystroke arms the scheduler and clears the field; the
 *    refill arrives when the corpus publishes.
 */

import {
  annotateRepaint,
  gestureTrace,
  editorPolicy,
  mountBookEditor,
  type BookEditorMount,
  type CorpusFinding,
  type EditorBook,
} from "@sefer/editor";
import type { SourceStamp } from "@sefer/text/source";
import { Effect, Fiber, Stream } from "effect";
import { createEffect, createRenderEffect, createSignal, untrack } from "solid-js";

import { stale } from "#core/findings/finding";

import { reportEdits } from "../editReports";
import { textDirection } from "../language";
import { useShell } from "../ProjectContext";
import { shellKeys } from "../settings";
import { useAlignedGroup } from "./workspace/aligned";
import { nameBlock } from "./workspace/blockNames";
import { LocationBar } from "./workspace/LocationBar";
import { metadataOf } from "./workspace/project";

// The editor's own stylesheet. It ships with the editor module and is imported
// where the view mounts, so a route that never opens a book never loads it.
import "@sefer/editor/editor.css";

export interface BookEditorProps {
  readonly book: EditorBook;
}

export function BookEditor(props: BookEditorProps) {
  const shell = useShell();
  /** Which way this project's scripture runs; see the host element below. */
  const direction = (): "ltr" | "rtl" => textDirection(metadataOf(shell.project()));
  // The book this instance is for, read once — see the mount effect below.
  const bookId = untrack(() => props.book.id);
  const [stamp, setStamp] = createSignal<SourceStamp | undefined>(undefined, { name: "stamp" });
  const [bound, setBound] = createSignal<BookEditorMount | undefined>(undefined, {
    name: "boundView",
  });
  /** The page's aligned group, when the editor is shown beside others. */
  const aligned = useAlignedGroup();
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

      const settings = shell.services.settings;
      const keys = shellKeys(settings);
      const editor = mountBookEditor({
        parent,
        book,
        // Where the caret is, published to the shell. The write is
        // unconditional and the consumers derive — see `Shell.noteCaret`.
        onCaret: (head) => shell.noteCaret(head),
        // Blocks with no words, named where the words go. The initial value
        // is the reader's setting; the fiber below follows it, so turning it
        // off moves the page rather than the next reload.
        blockName: nameBlock,
        emptyBlocks: settings.get(keys.annotateEmptyParagraphs),
        pairBlocks: settings.get(keys.pairBlocks),
      });

      const supply = (): void => {
        const analysis = book.structure().analysis;
        // The gesture's trace goes with it: the pass this arms is debounced,
        // so it will carry `op.cause` rather than being a child of any one
        // keystroke. Called inside `book.changes`, which runs inside the
        // gesture, so the trace is the right one.
        if (analysis !== null)
          shell.services.projectAnalysis.supply(book.id, analysis, gestureTrace());
      };
      supply();

      // This editor reports this book's edits; the shell stands aside for it.
      const releaseReports = reportEdits(book.id);
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
        // This book's share only — converted on its own, not by converting the
        // whole project's list to filter it.
        for (const finding of shell.services.projectAnalysis.crossBookOf(book.id))
          if (!stale(finding, book)) list.push(finding);
        editor.setHostDiagnostics(list);
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
            editor.setEmptyBlocks(on);
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
            editor.setPairBlocks(on);
          }),
        ),
      );

      // The location bar's reading. One passive scroll listener, coalesced into
      // an animation frame by the recipe.
      const unwatch = editor.onViewport((where) => {
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
      if (remembered !== undefined) editor.resume(remembered);

      setBound(editor);

      // Beside the references, the editor leads them and follows them.
      const leave = aligned?.join({ editor, book: bookId });

      // RETURNED, not `onCleanup`. A Solid 2 effect's cleanup is its return
      // value; `onCleanup` inside an effect callback is called outside any
      // owner and never runs at all (NO_OWNER_CLEANUP, which the dev build says
      // out loud). Everything below was leaking: the view was never destroyed,
      // the book stayed bound, and the analysis fiber outlived the screen.
      return () => {
        leave?.();
        unwatch();
        // No editor, no caret. Left set, it would point into a document that
        // is gone and every pane beside it would keep a stale highlight.
        shell.noteCaret(undefined);
        Effect.runFork(Fiber.interrupt(ghosting));
        Effect.runFork(Fiber.interrupt(pairing));
        Effect.runFork(Fiber.interrupt(watching));
        unsubscribe();
        releaseReports();
        editor.destroy();
        setBound(undefined);
      };
    },
  );

  // The view choices: which classes paint how, and which chapter is editable.
  // Flipping Regular/USFM keeps the reader where they were (`setPolicy`); a clip
  // does not re-anchor, which would fight the deliberate jump just asked for.
  createRenderEffect(
    () => ({ editor: bound(), mode: shell.mode(), chapter: shell.chapter() }),
    ({ editor, mode, chapter }) => {
      if (editor === undefined) return;
      editor.setPolicy(editorPolicy(mode === "usfm" ? "usfm" : "regular"));
      editor.setChapter(chapter);
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
    () => ({ editor: bound(), aimed: shell.reveal() }),
    ({ editor, aimed }) => {
      if (editor === undefined || aimed === undefined || aimed.bookId !== bookId) return;
      // A finding or a search hit is a point in the middle of a page, so it is
      // centred; a CHAPTER is the first line you read, so it goes to the top
      // with the rest of the book below it. The caret goes too (`jump`).
      const cancel = editor.jump(
        { from: aimed.from, ...(aimed.to === undefined ? {} : { to: aimed.to }) },
        aimed.at === "top" ? "top" : "center",
      );
      // A jump on purpose leads the references beside it, as a scroll would;
      // the group does not hear it otherwise, since nobody scrolled.
      aligned?.lead(editor);
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
