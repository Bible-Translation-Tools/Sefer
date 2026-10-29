import {
  annotateRepaint,
  gestureTrace,
  editorFeatures,
  editorPolicy,
  mountBookEditor,
  revealEditorInBand,
  type BookEditorMount,
  type CorpusAction,
  type CorpusFinding,
  type EditorBook,
} from "@sefer/editor";
import type { SourceStamp } from "@sefer/text/source";
import { Effect, Fiber, Stream } from "effect";
import { Show, createEffect, createRenderEffect, createSignal, untrack } from "solid-js";

import { stale, type Finding } from "#core/findings/finding";

import { editorWords } from "../editorWords";
import { reportEdits } from "../editReports";
import { t } from "../i18n";
import { textDirection } from "../language";
import { useShell } from "../ProjectContext";
import { shellKeys } from "../settings";
import { allow, checkLabel, fineHere, flaggedText, turnOff } from "../suppressAnswers";
import { LineMenu, type LineMenuAt } from "./LineMenu";
import { ChapterLabelsDialog } from "./rules/ChapterLabels";
import { useAlignedGroup } from "./workspace/aligned";
import { nameBlock } from "./workspace/blockNames";
import { metadataOf } from "./workspace/project";

import "@sefer/editor/editor.css";

export interface BookEditorProps {
  readonly book: EditorBook;
}

type Shell = ReturnType<typeof useShell>;

function watchCorpus(shell: Shell, editor: BookEditorMount, book: EditorBook) {
  const answersTo = (finding: Finding): readonly CorpusAction[] | undefined => {
    if (finding.producer !== "sous") return undefined;
    const check = checkLabel(finding);
    return [
      { name: t("Fine here"), run: () => fineHere(shell, finding) },
      ...(finding.pattern === undefined
        ? []
        : [
            {
              name: t("Always allow “{text}”", { text: flaggedText(shell, finding) }),
              run: () => allow(shell, finding),
            },
          ]),
      ...(check === undefined
        ? []
        : [{ name: t("Turn off “{check}”", { check }), run: () => turnOff(shell, finding) }]),
    ];
  };
  const corpus = (): void => {
    const list: CorpusFinding[] = [];
    for (const finding of shell.services.projectAnalysis.crossBookOf(book.id))
      if (!stale(finding, book)) list.push({ ...finding, actions: answersTo(finding) });
    editor.setHostDiagnostics(list);
    annotateRepaint({
      "findings.shown": list.length,
      "book.id": book.id,
      "book.revision": book.source().stamp.revision,
    });
  };
  corpus();
  const watching = shell.services.runtime.runFork(
    Stream.runForEach(shell.services.projectAnalysis.watch(), () => Effect.sync(corpus)),
  );
  const unsuppressing = shell.services.projectAnalysis.onSuppressions(corpus);
  return { watching, unsuppressing };
}

function watchSettings(shell: Shell, editor: BookEditorMount) {
  const ghostKey = shellKeys(shell.services.settings).annotateEmptyParagraphs;
  const ghosting = shell.services.runtime.runFork(
    Stream.runForEach(shell.services.settings.changes(ghostKey), (on) =>
      Effect.sync(() => {
        editor.setEmptyBlocks(on);
      }),
    ),
  );

  const pairKey = shellKeys(shell.services.settings).pairBlocks;
  const pairing = shell.services.runtime.runFork(
    Stream.runForEach(shell.services.settings.changes(pairKey), (on) =>
      Effect.sync(() => {
        editor.setPairBlocks(on);
      }),
    ),
  );
  const shortcutsKey = shellKeys(shell.services.settings).verseShortcuts;
  const shortcuts = shell.services.runtime.runFork(
    Stream.runForEach(shell.services.settings.changes(shortcutsKey), (on) =>
      Effect.sync(() => {
        editor.setPreferences({ verseShortcuts: on });
      }),
    ),
  );
  return { ghosting, pairing, shortcuts };
}

export function BookEditor(props: BookEditorProps) {
  const shell = useShell();
  const direction = (): "ltr" | "rtl" => textDirection(metadataOf(shell.project()));
  const bookId = untrack(() => props.book.id);
  const [stamp, setStamp] = createSignal<SourceStamp | undefined>(undefined, { name: "stamp" });
  const [bound, setBound] = createSignal<BookEditorMount | undefined>(undefined, {
    name: "boundView",
  });
  const aligned = useAlignedGroup();
  const [lineMenu, setLineMenu] = createSignal<LineMenuAt | undefined>(undefined, {
    name: "lineMenu",
  });
  const [labelsOpen, setLabelsOpen] = createSignal(false, { name: "chapterLabelsOpen" });
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "editorHost",
  });

  createEffect(
    () => host(),
    (parent) => {
      if (parent === undefined) return;
      const remembered = shell.resumePlace(bookId);
      // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
      const book = untrack(() => props.book);

      const settings = shell.services.settings;
      const keys = shellKeys(settings);
      const editor = mountBookEditor({
        parent,
        book,
        onCaret: (head) => shell.noteCaret(head),
        blockName: nameBlock,
        emptyBlocks: settings.get(keys.annotateEmptyParagraphs),
        pairBlocks: settings.get(keys.pairBlocks),
        preferences: { verseShortcuts: settings.get(keys.verseShortcuts) },
        features: editorFeatures(),
        words: editorWords,
      });

      const supply = (): void => {
        const analysis = book.structure().analysis;
        if (analysis !== null)
          shell.services.projectAnalysis.supply(book.id, analysis, gestureTrace());
      };
      supply();

      const releaseReports = reportEdits(book.id);
      const unsubscribe = book.changes((receipt) => {
        setStamp(receipt.after);
        supply();
        shell.changed({ kind: "book.apply", books: [book.id] });
      });

      const { watching, unsuppressing } = watchCorpus(shell, editor, book);

      const { ghosting, pairing, shortcuts } = watchSettings(shell, editor);

      const unwatch = editor.onViewport((where) => {
        if (where !== null)
          shell.noteChapterAtTop(where.ordinal, {
            chapter: where.topChapter ?? where.label,
            offset: where.top,
            length: where.length,
            ...(where.hash === undefined ? {} : { hash: where.hash }),
            ...(where.verse === undefined ? {} : { verse: where.verse }),
          });
      });

      if (remembered !== undefined) editor.resume(remembered);

      // A chapter's title opens its labels, project-wide (ui/rules/ChapterLabels.tsx).
      const untitle = editor.onChapterTitle(() => setLabelsOpen(true));

      setBound(editor);

      const leave = aligned?.join({ editor, book: bookId });

      // Returned, not onCleanup: a Solid 2 effect's callback has no owner (NO_OWNER_CLEANUP).
      return () => {
        leave?.();
        untitle();
        unwatch();
        shell.noteCaret(undefined);
        Effect.runFork(Fiber.interrupt(ghosting));
        Effect.runFork(Fiber.interrupt(pairing));
        Effect.runFork(Fiber.interrupt(shortcuts));
        Effect.runFork(Fiber.interrupt(watching));
        unsuppressing();
        unsubscribe();
        releaseReports();
        editor.destroy();
        setBound(undefined);
      };
    },
  );

  createRenderEffect(
    () => ({
      editor: bound(),
      mode: shell.mode(),
      lines: shell.lineByLine(),
      chapter: shell.chapter(),
    }),
    ({ editor, mode, lines, chapter }) => {
      if (editor === undefined) return;
      if (mode === "usfm") editor.setPolicy(editorPolicy("usfm"));
      else if (lines) editor.setPolicy(editorPolicy("regular", "line-by-line"));
      else editor.setPolicy(editorPolicy("regular"));
      editor.setChapter(chapter);
    },
  );

  createEffect(
    () => ({ editor: bound(), aimed: shell.reveal() }),
    ({ editor, aimed }) => {
      if (editor === undefined || aimed === undefined || aimed.bookId !== bookId) return;
      if (aimed.caret === "keep") {
        // Only into view, and only when it is not already in the middle band:
        // the caret, and so the reference's pair, stay put.
        revealEditorInBand(editor, aimed.from);
        return;
      }
      const cancel = editor.jump(
        { from: aimed.from, ...(aimed.to === undefined ? {} : { to: aimed.to }) },
        aimed.at === "top" ? "top" : "center",
      );
      aligned?.lead(editor);
      return cancel;
    },
  );

  return (
    <div
      class="editor-host"
      data-bare=""
      data-testid="editor-card"
      data-mode={shell.mode()}
      data-revision={(stamp() ?? props.book.source().stamp).revision}
    >
      {/* Right-click on a line: its type and what it can turn into (Refine only;
          Form Mode and USFM keep the browser's own menu). */}
      <div
        class="cm-host"
        dir={direction()}
        data-testid="editor-host"
        ref={setHost}
        onContextMenu={(event) => {
          const editor = bound();
          if (editor === undefined) return;
          const offset = editor.offsetAt({ x: event.clientX, y: event.clientY });
          const line = offset === undefined ? null : editor.lineKindAt(offset);
          if (offset === undefined || line === null) return;
          event.preventDefault();
          setLineMenu({ x: event.clientX, y: event.clientY, offset, line });
        }}
      />
      <Show when={bound()}>
        {(editor) => (
          <Show when={lineMenu()} keyed>
            {(at) => <LineMenu editor={editor()} at={at} onClose={() => setLineMenu(undefined)} />}
          </Show>
        )}
      </Show>
      {/* Mounted only while open: each opening starts from the books as they are. */}
      <Show when={labelsOpen()}>
        <ChapterLabelsDialog open onOpenChange={setLabelsOpen} />
      </Show>
    </div>
  );
}
