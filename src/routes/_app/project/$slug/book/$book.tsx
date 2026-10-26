import type { EditorBook } from "@sefer/editor";
import { createFileRoute } from "@tanstack/solid-router";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import { Show, createEffect, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";
import { useShell } from "#app/ProjectContext";
import { REFERENCE_WIDTH } from "#app/settings";
import { BookEditor } from "#app/ui/BookEditor";
import { Button, DelayedSpinner, Resizable, cx } from "#app/ui/primitives";
import { RecoveryBanner } from "#app/ui/recovery/RecoveryBanner";
import { AlignedProvider } from "#app/ui/workspace/aligned";
import { BookViewSwitch } from "#app/ui/workspace/BookViewSwitch";
import { ReferenceColumn } from "#app/ui/workspace/ReferenceColumn";
import { Toolbar } from "#app/ui/workspace/Toolbar";

/**
 * The editor: the heart language, the only text that can be
 * edited, outlined on the page's white, the outline brand while it has focus.
 * A small action bar over the text: "Show reference" on the left (the only
 * way to the gateways — joined, there is none on screen), the book's view
 * (Reading, Line by line, USFM) flush right.
 * Split, its left border is the resize handle's line.
 */
function EditorPanel(props: { readonly book: EditorBook; readonly split?: boolean }) {
  const shell = useShell();
  return (
    <section
      aria-label={m.refine_editor_label()}
      data-testid="refine-editor"
      class={cx(
        // The page's own white, outlined: the border goes brand while the
        // text has focus. Split, its left edge is also the resize handle's line.
        "flex min-h-0 flex-1 flex-col rounded-lg border-2 border-surface-border bg-surface-primary transition-colors focus-within:border-brand",
      )}
    >
      {/* 12px top and bottom; each side lines up with the text's own edge:
          the same side padding as the editor below, and the same centred
          measure as its text column (`--editor-measure`, editor.css). */}
      <div class="shrink-0 px-6">
        <div class="mx-auto flex max-w-(--editor-measure) items-center gap-controls py-3">
          <Button
            variant="tertiary"
            data-testid="refine-reference"
            onClick={() => shell.setReferenceSplit(props.split !== true)}
          >
            <Show when={props.split === true} fallback={<PanelLeftOpen aria-hidden="true" />}>
              <PanelLeftClose aria-hidden="true" />
            </Show>
            {props.split === true ? m.refine_hide_reference() : m.refine_show_reference()}
          </Button>
          <BookViewSwitch class="ms-auto" />
        </div>
      </div>
      <div class="flex min-h-0 flex-1 flex-col px-6">
        <Show when={props.book.id} keyed>
          <BookEditor book={props.book} />
        </Show>
      </div>
    </section>
  );
}

function BookPage(props: { readonly root: string; readonly bookId: string }) {
  const shell = useShell();
  const referenceInitial = untrack(() => shell.referenceWidth());

  createEffect(
    () => ({ root: props.root, bookId: props.bookId }),
    ({ root, bookId }) => {
      // An effect's callback is untracked in Solid 2: a deliberate one-time question, said with untrack.
      const open = untrack(() => shell.project()?.root);
      const opened = open === root ? Promise.resolve() : untrack(() => shell.openProject(root));
      void opened.then(() => shell.focus(bookId));
    },
  );

  /**
   * The measure shared by the toolbar and the panels under it so their edges
   * line up: joined, one panel, the editor's text measure (`--editor-measure`,
   * 40rem) and 10rem round it — 50rem; split, two of those and the 1.5rem
   * handle between them, shared as the handle sets.
   */
  const measure = (): string =>
    cx(
      "mx-auto w-full",
      shell.referenceSplit()
        ? "max-w-[calc(2_*_(var(--editor-measure)_+_10rem)_+_1.5rem)]"
        : "max-w-[calc(var(--editor-measure)_+_10rem)]",
    );

  return (
    <main class="flex h-full min-h-0 min-w-0 flex-col gap-3 bg-surface-primary p-6">
      <RecoveryBanner />
      <Show
        when={shell.recoveryOffer() !== undefined ? shell.focused() : undefined}
        fallback={
          <div class="h-full" data-opening={props.bookId}>
            <DelayedSpinner />
          </div>
        }
      >
        {(book) => (
          <>
            <div class={measure()}>
              <Toolbar />
            </div>

            {/* One white surface. Joined, only the heart language is on
                screen, in its editor panel; split, the reference sits to its
                left, bare on the page, under one language-and-text dropdown.

                NO aligned group: each side scrolls on its own, and the
                gateways catch up when the reader clicks in the heart language
                — the caret's paired-verse reveal in each pane. Provided as
                `null`: none, said explicitly. */}
            <AlignedProvider value={null}>
              <div class={cx("flex min-h-0 flex-1", measure())}>
                <Show when={shell.referenceSplit()} fallback={<EditorPanel book={book()} />}>
                  <Resizable.Root
                    class="min-h-0 min-w-0 flex-1"
                    onSizesChange={(sizes) => {
                      const first = sizes[0];
                      if (first !== undefined) shell.setReferenceWidth(first);
                    }}
                  >
                    {/* The reference: no border, no surface, straight on the
                        page — only the editor beside it is a panel. 14px down:
                        the editor's 2px outline and 12px padding, so the two
                        control rows share a line. */}
                    <Resizable.Panel
                      initialSize={referenceInitial}
                      minSize={REFERENCE_WIDTH.min}
                      maxSize={REFERENCE_WIDTH.max}
                      class="flex min-w-0 flex-col pe-6 pt-3.5"
                    >
                      <ReferenceColumn />
                    </Resizable.Panel>
                    {/* The editor's left border IS the handle: an edge handle,
                        nudged 1px so its 2px line lies exactly over the border
                        it lights up. */}
                    <Resizable.Handle
                      edge
                      class="translate-x-px"
                      label={m.refine_resize_reference()}
                    />
                    <Resizable.Panel class="flex min-w-0 flex-col">
                      <EditorPanel book={book()} split />
                    </Resizable.Panel>
                  </Resizable.Root>
                </Show>
              </div>
            </AlignedProvider>
          </>
        )}
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/_app/project/$slug/book/$book")({
  head: () => ({ meta: [{ title: "Sefer — book" }] }),
  component: () => {
    const params = Route.useParams();
    const shell = useShell();
    return (
      <BookPage root={shell.project()?.root ?? ""} bookId={decodeURIComponent(params().book)} />
    );
  },
});
