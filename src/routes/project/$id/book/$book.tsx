import { createFileRoute } from "@tanstack/solid-router";
import { Show, createEffect } from "solid-js";

import { t } from "../../../../app/i18n";
import { useShell } from "../../../../app/ProjectContext";
import { BookEditor } from "../../../../app/ui/BookEditor";
import { Resizable } from "../../../../app/ui/primitives";
import { ShellGate } from "../../../../app/ui/ShellGate";
import { ReferenceColumn } from "../../../../app/ui/workspace/ReferenceColumn";
import { Toolbar } from "../../../../app/ui/workspace/Toolbar";

/**
 * The editor screen: the workspace toolbar, the reference column, and the book
 * in a card.
 *
 * The chapter picker is gone from this page on purpose. A book opens WHOLE —
 * one document, scrolled — and narrowing it to a chapter is a navigation, so
 * it belongs where every other navigation is: the chapter grid under the
 * focused book in the project sidebar (`src/app/ui/workspace/ProjectSidebar.tsx`).
 * `editor.preferChapterView` still decides what a book opens on; the shell
 * reads it in `focus`, and `editor.chapter.next/previous/whole` still work
 * from the palette.
 *
 * Everything on this page reads the Book through the shell. The page itself
 * holds no text, no structure and no analysis — `BookEditor` owns the one
 * subscription, and this component only reads what the shell already knows.
 */

/** The reference column's share of the editor row, and the range a drag reaches. */
const REFERENCE = { initial: 0.3, min: 0.18, max: 0.5 } as const;

function BookPage(props: { readonly root: string; readonly bookId: string }) {
  const shell = useShell();

  // Open the project and seat the book the URL names, and do it again whenever
  // the URL names a different one. Idempotent: `focus` runs
  // `project.instantiate`, which is itself idempotent.
  createEffect(
    () => ({ root: props.root, bookId: props.bookId }),
    ({ root, bookId }) => {
      const opened = shell.project()?.root === root ? Promise.resolve() : shell.openProject(root);
      void opened.then(() => shell.focus(bookId));
    },
  );

  const stamp = () => {
    shell.tick();
    return shell.focused()?.source().stamp;
  };

  const dirty = (): boolean => {
    const book = shell.focused();
    return book !== undefined && shell.unsaved(book);
  };

  return (
    <main class="flex h-full min-h-0 min-w-0 flex-col gap-3 p-4">
      <Show
        when={shell.focused()}
        fallback={<p class="text-small text-on-surface-tertiary">{shell.status()}</p>}
      >
        {(book) => (
          <>
            <Toolbar shell={shell} />

            <Resizable.Root class="min-h-0 flex-1">
              <Resizable.Panel
                initialSize={REFERENCE.initial}
                minSize={REFERENCE.min}
                maxSize={REFERENCE.max}
              >
                <ReferenceColumn shell={shell} />
              </Resizable.Panel>
              <Resizable.Handle label={t("Resize the reference column")} />
              {/* No `<Card>` around the editor: `.editor-host` (app.css) IS
                  the card — white, bordered, 12px radius — and the scripture's
                  own generous padding is inside the view, where CodeMirror can
                  keep the measure at 40rem and centre it. A second card would
                  be a second border around the same rectangle. */}
              <Resizable.Panel class="flex flex-col gap-2 py-4 pe-1">
                {/* Keyed on the book id: a different book is a different
                    canonical state, so the view is rebuilt rather than
                    repointed. */}
                <div class="flex min-h-0 flex-1 flex-col">
                  <Show when={book().id} keyed>
                    <BookEditor book={book()} />
                  </Show>
                </div>

                <div class="flex gap-4 px-1 text-smallest tabular-nums text-on-surface-tertiary">
                  <span data-revision={stamp()?.revision}>
                    {t("r{revision}", { revision: stamp()?.revision ?? 0 })}
                  </span>
                  <span>{t("{length} chars", { length: stamp()?.length ?? 0 })}</span>
                  <span data-dirty={String(dirty())}>{dirty() ? t("unsaved") : t("saved")}</span>
                </div>
              </Resizable.Panel>
            </Resizable.Root>
          </>
        )}
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/project/$id/book/$book")({
  head: () => ({ meta: [{ title: "Sefer — book" }] }),
  component: () => {
    const params = Route.useParams();
    return (
      <ShellGate>
        {() => (
          <BookPage
            root={decodeURIComponent(params().id)}
            bookId={decodeURIComponent(params().book)}
          />
        )}
      </ShellGate>
    );
  },
});
