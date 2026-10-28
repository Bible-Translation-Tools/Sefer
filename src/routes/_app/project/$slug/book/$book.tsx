import type { EditorBook } from "@sefer/editor";
import { createFileRoute } from "@tanstack/solid-router";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import { Show, createEffect, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";
import { useShell } from "#app/ProjectContext";
import { REFERENCE_WIDTH } from "#app/settings";
import { BookEditor } from "#app/ui/BookEditor";
import { Button, DelayedSpinner, Resizable } from "#app/ui/primitives";
import { RecoveryBanner } from "#app/ui/recovery/RecoveryBanner";
import { AlignedProvider } from "#app/ui/workspace/aligned";
import { ReferenceColumn } from "#app/ui/workspace/ReferenceColumn";
import { BookTitle, BookTools } from "#app/ui/workspace/Toolbar";

/**
 * The editor: the heart language, the only text that can be edited, a white
 * panel on the grey page, with no outline.
 * Over the text, one bar: the book and chapter on the left, and flush right
 * search, "Show reference" (the only way to the gateways — joined, there is
 * none on screen) and the book's kebab, which holds the USFM and One chapter
 * switches and Match formatting from source. Undo and Redo are in the app
 * bar; Findings in its More menu.
 * Split, its left border is the resize handle's line.
 */
function EditorPanel(props: { readonly book: EditorBook; readonly split?: boolean }) {
  const shell = useShell();
  return (
    <section
      aria-label={m.refine_editor_label()}
      data-testid="refine-editor"
      // The page is grey; only the editor and the book menu are white. No
      // outline: the white is the edge. Line by line's own verse boxes sit
      // on the white.
      class="flex min-h-0 flex-1 flex-col rounded-lg bg-surface-primary"
    >
      {/* 12px top and bottom; each side lines up with the text's own edge:
          the same side padding as the editor below, and the same centred
          measure as its text column (`--editor-measure`, editor.css). */}
      {/* A rule under the bar in every view, line by line included: the
          panel's own 2px outline colour. */}
      <div class="shrink-0 border-b-2 border-surface-border px-6">
        <div class="mx-auto flex max-w-(--editor-measure) items-center gap-controls py-3">
          {/* Where the reader is: the book and its chapter. */}
          <BookTitle />
          <span class="ms-auto" />
          <BookTools>
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
          </BookTools>
        </div>
      </div>
      {/* No side padding: the scroller runs to the panel's edge, so its
          scrollbar sits flush right; the text keeps its own inset (editor.css). */}
      <div class="flex min-h-0 flex-1 flex-col">
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

  return (
    <main class="flex h-full min-h-0 min-w-0 flex-col gap-3 bg-surface-canvas p-6">
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
            {/* One white surface. Joined, only the heart language is on
                screen, in its editor panel; split, the reference sits to its
                left, bare on the page, under one language-and-text dropdown.

                NO aligned group: each side scrolls on its own, and the
                gateways catch up when the reader clicks in the heart language
                — the caret's paired-verse reveal in each pane. Provided as
                `null`: none, said explicitly. */}
            <AlignedProvider value={null}>
              <div class="flex min-h-0 w-full flex-1">
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
