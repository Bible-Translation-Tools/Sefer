import {
  annotateRepaint,
  gestureTrace,
  editorPolicy,
  mountBookEditor,
  type BookEditorMount,
  type CorpusAction,
  type CorpusFinding,
  type EditorBook,
} from "@sefer/editor";
import type { SourceStamp } from "@sefer/text/source";
import { Effect, Fiber, Stream } from "effect";
import { createEffect, createRenderEffect, createSignal, untrack } from "solid-js";

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
      const remembered = untrack(() => {
        if (shell.reveal()?.bookId === bookId) return undefined;
        const root = shell.project()?.root;
        const held = root === undefined ? undefined : shell.lastLocation(root);
        return held?.bookId === bookId ? held.place : undefined;
      });
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
    () => ({ editor: bound(), mode: shell.mode(), chapter: shell.chapter() }),
    ({ editor, mode, chapter }) => {
      if (editor === undefined) return;
      editor.setPolicy(editorPolicy(mode === "usfm" ? "usfm" : "regular"));
      editor.setChapter(chapter);
    },
  );

  createEffect(
    () => ({ editor: bound(), aimed: shell.reveal() }),
    ({ editor, aimed }) => {
      if (editor === undefined || aimed === undefined || aimed.bookId !== bookId) return;
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
      class="editor-host shadow-small"
      data-testid="editor-card"
      data-mode={shell.mode()}
      data-revision={(stamp() ?? props.book.source().stamp).revision}
    >
      <LocationBar ordinal={atTop()} />

      <div class="cm-host" dir={direction()} data-testid="editor-host" ref={setHost} />
    </div>
  );
}
