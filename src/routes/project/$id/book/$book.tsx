import { createFileRoute } from "@tanstack/solid-router";
import { Show, createEffect, createSignal, untrack } from "solid-js";

import { t } from "../../../../app/i18n";
import { useShell } from "../../../../app/ProjectContext";
import { REFERENCE_WIDTH } from "../../../../app/settings";
import { BookEditor } from "../../../../app/ui/BookEditor";
import { Resizable, cx } from "../../../../app/ui/primitives";
import { RecoveryBanner } from "../../../../app/ui/recovery/RecoveryBanner";
import { ShellGate } from "../../../../app/ui/ShellGate";
import { bookName } from "../../../../app/ui/workspace/books";
import { metadataOf } from "../../../../app/ui/workspace/project";
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

function BookPage(props: { readonly root: string; readonly bookId: string }) {
  const shell = useShell();
  // Plain variables: `Resizable.Panel` reads its three sizes once, during
  // registration, and a JSX expression there is a memo read outside a tracking
  // scope — which Solid 2 warns about, correctly. The initial width is the
  // REMEMBERED one (`workspace.referenceWidth`); the split owns it from there
  // and hands it back on every drag.
  const referenceInitial = untrack(() => shell.referenceWidth());
  const referenceMin = REFERENCE_WIDTH.min;
  const referenceMax = REFERENCE_WIDTH.max;

  /**
   * How many references are bound, reported by the column.
   *
   * With none, the pane is not a pane — it is the picker, and the editor
   * should have the rest of the row. The panel stays MOUNTED and takes a fixed
   * narrow basis instead of being removed, for the reason `__root.tsx` gives
   * about the sidebar: `Resizable` registers panels during render and has no
   * unregister, so an unmounted panel renumbers the split and destroys the
   * editor's view beside it.
   */
  const [references, setReferences] = createSignal(0, { name: "boundReferences" });
  const collapsed = (): boolean => references() === 0;

  // Open the project and seat the book the URL names, and do it again whenever
  // the URL names a different one. Idempotent: `focus` runs
  // `project.instantiate`, which is itself idempotent.
  createEffect(
    () => ({ root: props.root, bookId: props.bookId }),
    ({ root, bookId }) => {
      // `untrack`, and not merely a read: an effect's callback is an untracked
      // scope in Solid 2, so a bare `shell.project()` here is a read the
      // runtime warns about (STRICT_READ_UNTRACKED) rather than a subscription.
      // It is a deliberate one-time question — is the project this URL names
      // already open — and saying so to the compiler is the whole fix.
      const open = untrack(() => shell.project()?.root);
      const opened = open === root ? Promise.resolve() : untrack(() => shell.openProject(root));
      void opened.then(() => shell.focus(bookId));
    },
  );

  // The focused book's row of the shell's `books` store. Same answer as
  // reading the Book, but only this book's edits wake it.
  const stamp = () => {
    const book = shell.focused();
    return book === undefined ? undefined : shell.stampOf(book.id);
  };

  const dirty = (): boolean => {
    const book = shell.focused();
    return book !== undefined && shell.unsaved(book);
  };

  /**
   * The status line's three words, and none of them is "saved".
   *
   * Sefer writes the file only when a version is recorded, so "saved" would
   * have had to mean two different things a second apart. What a reader needs
   * to know is whether the work exists anywhere but the editor and the backup
   * ("unsaved"), whether it is in the history ("recorded"), or whether it
   * reached the file with no version behind it ("on disk, not recorded") —
   * which happens when a write succeeds and the commit after it does not.
   */
  const state = (): "unsaved" | "onDisk" | "recorded" => {
    const book = shell.focused();
    return book === undefined ? "recorded" : shell.saveState(book);
  };

  const stateLabel = (): string => {
    const held = state();
    if (held === "unsaved") return t("unsaved");
    return held === "onDisk" ? t("on disk, not recorded") : t("recorded");
  };

  return (
    <main class="flex h-full min-h-0 min-w-0 flex-col gap-3 p-4">
      {/* Above everything, and on THIS route as well as the project page:
          unsaved work found on open is the first thing to answer, and opening
          a project now lands on the book rather than on the census, so a
          banner mounted only there is a banner nobody sees. */}
      <RecoveryBanner />
      <Show
        when={shell.focused()}
        fallback={
          /* Opening a book parses it, and a big one takes long enough that a
             blank card reads as a broken link. The line says which book and
             the bar says it is still happening; the status line underneath
             says what the shell last did. */
          <div class="space-y-3" data-opening={props.bookId}>
            <p class="text-small text-on-surface-secondary">
              {t("Opening {book}…", {
                book: bookName(props.bookId, metadataOf(shell.project())),
              })}
            </p>
            <div
              aria-hidden="true"
              class="h-0.5 w-full overflow-hidden rounded-full bg-surface-tertiary"
            >
              <div class="h-full w-1/3 animate-pulse rounded-full bg-brand" />
            </div>
            <p class="text-smallest text-on-surface-tertiary">{shell.status()}</p>
          </div>
        }
      >
        {(book) => (
          <>
            <Toolbar />

            <Resizable.Root
              class="min-h-0 flex-1"
              onSizesChange={(sizes) => {
                const first = sizes[0];
                if (first !== undefined) shell.setReferenceWidth(first);
              }}
            >
              <Resizable.Panel
                initialSize={referenceInitial}
                minSize={referenceMin}
                maxSize={referenceMax}
                class={collapsed() ? "[flex-basis:13rem]!" : undefined}
              >
                <ReferenceColumn onBound={setReferences} />
              </Resizable.Panel>
              {/* Hidden rather than unmounted, same reason as the panel. */}
              <Resizable.Handle
                label={t("Resize the reference pane")}
                class={collapsed() ? "hidden" : undefined}
              />
              {/* No `<Card>` around the editor: `.editor-host` (app.css) IS
                  the card — white, bordered, 12px radius — and the scripture's
                  own generous padding is inside the view, where CodeMirror can
                  keep the measure at 40rem and centre it. A second card would
                  be a second border around the same rectangle. */}
              <Resizable.Panel
                class={cx(
                  "flex flex-col gap-2 py-4 pe-1",
                  // With the pane collapsed the editor takes the row back; the
                  // `!` is load-bearing because `Resizable.Panel` writes its
                  // share as an inline `flex-basis`.
                  collapsed() ? "grow! [flex-basis:auto]!" : undefined,
                )}
              >
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
                  <span data-dirty={String(dirty())} data-save-state={state()}>
                    {stateLabel()}
                  </span>
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
