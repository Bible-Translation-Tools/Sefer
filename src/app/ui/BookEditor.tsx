import {
  annotateRepaint,
  gestureTrace,
  editorFeatures,
  editorPolicy,
  mountBookEditor,
  type BookEditorMount,
  type CorpusAction,
  type CorpusFinding,
  type EditorBook,
} from "@sefer/editor";
import type { SourceStamp } from "@sefer/text/source";
import { Effect, Fiber, Stream } from "effect";
import { Show, createEffect, createRenderEffect, createSignal, untrack } from "solid-js";

import { stale, type Finding } from "#core/findings/finding";

import { reportEdits } from "../editReports";
import { t } from "../i18n";
import { textDirection } from "../language";
import { useShell } from "../ProjectContext";
import { shellKeys } from "../settings";
import { allow, checkLabel, fineHere, flaggedText, turnOff } from "../suppressAnswers";
import { useAlignedGroup } from "./workspace/aligned";
import { nameBlock } from "./workspace/blockNames";
import { LocationBar } from "./workspace/LocationBar";
import { metadataOf } from "./workspace/project";

import "@sefer/editor/editor.css";

export interface BookEditorProps {
  readonly book: EditorBook;
  /**
   * Straight on the page, with no card and no location bar: Refine's language
   * panels (a design tweak), where the USFM switch is in the toolbar instead.
   */
  readonly bare?: boolean;
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
  return { ghosting, pairing };
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
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "editorHost",
  });
  const [atTop, setAtTop] = createSignal<number | undefined>(undefined, { name: "chapterAtTop" });

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
        features: editorFeatures(),
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

      const { ghosting, pairing } = watchSettings(shell, editor);

      const unwatch = editor.onViewport((where) => {
        setAtTop(where === null ? undefined : where.ordinal);
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

      setBound(editor);

      const leave = aligned?.join({ editor, book: bookId });

      // Returned, not onCleanup: a Solid 2 effect's callback has no owner (NO_OWNER_CLEANUP).
      return () => {
        leave?.();
        unwatch();
        shell.noteCaret(undefined);
        Effect.runFork(Fiber.interrupt(ghosting));
        Effect.runFork(Fiber.interrupt(pairing));
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
        // Only into view: the caret, and so the reference's pair, stay put.
        editor.reveal(
          { from: aimed.from, ...(aimed.to === undefined ? {} : { to: aimed.to }) },
          { scroll: aimed.at === "top" ? "start" : "center" },
        );
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
      class={props.bare === true ? "editor-host" : "editor-host shadow-small"}
      data-bare={props.bare === true ? "" : undefined}
      data-testid="editor-card"
      data-mode={shell.mode()}
      data-revision={(stamp() ?? props.book.source().stamp).revision}
    >
      <Show when={props.bare !== true}>
        <LocationBar ordinal={atTop()} />
      </Show>

      <div class="cm-host" dir={direction()} data-testid="editor-host" ref={setHost} />
    </div>
  );
}
