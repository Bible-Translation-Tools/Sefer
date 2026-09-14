import { createFileRoute } from "@tanstack/solid-router";
import BookOpen from "lucide-solid/icons/book-open";
import Code from "lucide-solid/icons/code";
import { For, Show, createEffect } from "solid-js";

import { runCommand } from "../../../../app/commands";
import { t } from "../../../../app/i18n";
import { useShell } from "../../../../app/ProjectContext";
import { BookEditor } from "../../../../app/ui/BookEditor";
import { Button, SegmentedControl, Select } from "../../../../app/ui/primitives";
import { ShellGate } from "../../../../app/ui/ShellGate";

/**
 * The editor screen: a chapter picker, a mode toggle, the mounted book, and a
 * status line.
 *
 * A book opens WHOLE — one document, scrolled — and the chapter picker is a
 * way to narrow that. `editor.preferChapterView` (the shell's setting, read
 * through `shell.preferChapterView()`) flips which of the two is the point:
 * with it on the book opens clipped and the picker is labelled and prominent,
 * with it off the picker is a plain control that clips on demand.
 *
 * Everything on this page reads the Book through the shell. The page itself
 * holds no text, no structure and no analysis — `BookEditor` owns the one
 * subscription, and this component only reads what the shell already knows.
 *
 * The mode switcher is the mockups' segmented control, with two segments and
 * not four: Key terms and Form are screens that do not exist yet, and an
 * offered mode that cannot be entered is worse than an absent one.
 */

const MODES = [
  { value: "regular", label: "Regular", icon: <BookOpen size={14} /> },
  { value: "usfm", label: "USFM", icon: <Code size={14} /> },
] as const;

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
    <main class="min-w-0 p-6">
      <Show
        when={shell.focused()}
        fallback={<p class="text-small text-on-surface-tertiary">{shell.status()}</p>}
      >
        {(book) => (
          <div class="flex h-[calc(100vh-3rem)] flex-col gap-3">
            <div class="flex flex-wrap items-center gap-3">
              <strong class="text-h4 font-semibold text-on-surface-primary">{book().id}</strong>

              {/* The picker works either way — picking a chapter clips, "Whole
                  book" un-clips — but it only claims space when the reader
                  asked to read a chapter at a time. `data-prominent` is the
                  hook the Select's own style rule hangs off. */}
              <Show when={shell.preferChapterView()}>
                <label for="chapter-picker" class="text-small text-on-surface-secondary">
                  {t("Chapter")}
                </label>
              </Show>
              <Select
                id="chapter-picker"
                size="sm"
                wrapperClass="w-44"
                aria-label={t("Chapter")}
                data-prominent={String(shell.preferChapterView())}
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
              </Select>

              <SegmentedControl
                label={t("Mode")}
                size="sm"
                items={MODES}
                value={shell.mode() === "usfm" ? "usfm" : "regular"}
                onChange={() => runCommand("editor.toggleMode")}
              />

              <Button variant="primary" class="ms-auto" onClick={() => runCommand("book.save")}>
                {t("Save")}
              </Button>
            </div>

            {/* Keyed on the book id: a different book is a different canonical
                state, so the view is rebuilt rather than repointed. */}
            <div class="flex min-h-0 flex-1 flex-col">
              <Show when={book().id} keyed>
                <BookEditor book={book()} />
              </Show>
            </div>

            <div class="flex gap-4 text-smallest tabular-nums text-on-surface-tertiary">
              <span data-revision={stamp()?.revision}>
                {t("r{revision}", { revision: stamp()?.revision ?? 0 })}
              </span>
              <span>{t("{length} chars", { length: stamp()?.length ?? 0 })}</span>
              <span data-dirty={String(dirty())}>{dirty() ? t("unsaved") : t("saved")}</span>
              <span class="ms-auto">{shell.status()}</span>
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
