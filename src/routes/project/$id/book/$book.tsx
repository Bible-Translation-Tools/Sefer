import { createFileRoute } from "@tanstack/solid-router";
import { For, Show, createEffect } from "solid-js";

import { runCommand } from "../../../../app/commands";
import { t } from "../../../../app/i18n";
import { useShell } from "../../../../app/ProjectContext";
import { BookEditor } from "../../../../app/ui/BookEditor";
import { ShellGate } from "../../../../app/ui/ShellGate";

/**
 * The editor screen: a chapter picker, a mode toggle, the mounted book, and a
 * status line.
 *
 * Everything on this page reads the Book through the shell. The page itself
 * holds no text, no structure and no analysis — `BookEditor` owns the one
 * subscription, and this component only reads what the shell already knows.
 */

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

  const chapters = (): readonly number[] => {
    shell.tick();
    const book = shell.focused();
    if (book === undefined) return [];
    return book.structure().chapters.map((_, index) => index);
  };

  const stamp = () => {
    shell.tick();
    return shell.focused()?.source().stamp;
  };

  const dirty = (): boolean => {
    const book = shell.focused();
    return book !== undefined && shell.unsaved(book);
  };

  return (
    <main>
      <Show when={shell.focused()} fallback={<p class="muted">{shell.status()}</p>}>
        {(book) => (
          <div class="editor-frame">
            <div class="row">
              <strong>{book().id}</strong>

              <select
                aria-label={t("Chapter")}
                value={shell.chapter() === null ? "" : String(shell.chapter())}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  shell.setChapter(value === "" ? null : Number(value));
                }}
              >
                <option value="">{t("Whole book")}</option>
                <For each={chapters()}>
                  {(ordinal) => (
                    <option value={String(ordinal)}>
                      {t("Chapter {number}", { number: ordinal + 1 })}
                    </option>
                  )}
                </For>
              </select>

              <button
                type="button"
                aria-pressed={shell.mode() === "usfm" ? "true" : "false"}
                onClick={() => runCommand("editor.toggleMode")}
              >
                {t("USFM")}
              </button>

              <button
                type="button"
                data-variant="primary"
                class="spacer"
                onClick={() => runCommand("book.save")}
              >
                {t("Save")}
              </button>
            </div>

            {/* Keyed on the book id: a different book is a different canonical
                state, so the view is rebuilt rather than repointed. */}
            <Show when={book().id} keyed>
              <BookEditor book={book()} />
            </Show>

            <div class="status-bar">
              <span data-revision={stamp()?.revision}>
                {t("r{revision}", { revision: stamp()?.revision ?? 0 })}
              </span>
              <span>{t("{length} chars", { length: stamp()?.length ?? 0 })}</span>
              <span data-dirty={String(dirty())}>{dirty() ? t("unsaved") : t("saved")}</span>
              <span class="muted spacer">{shell.status()}</span>
            </div>
          </div>
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
