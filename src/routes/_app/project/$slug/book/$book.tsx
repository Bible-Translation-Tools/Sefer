import { createFileRoute } from "@tanstack/solid-router";
import type { EditorBook } from "@wycliffeassociates/sefer-editor";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import Search from "lucide-solid/icons/search";
import { Show, createEffect, createSignal, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";
import { useShell } from "#app/ProjectContext";
import { REFERENCE_WIDTH } from "#app/settings";
import { BookEditor } from "#app/ui/BookEditor";
import { openFind } from "#app/ui/find/findState";
import { Button, DelayedSpinner, Resizable, cx } from "#app/ui/primitives";
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
  const [panel, setPanel] = createSignal<HTMLElement | undefined>(undefined, {
    name: "editorPanel",
  });
  // The bar's sides are MEASURED from the text's own edges: whatever moves
  // the text (a gutter, the scrollbar, the column centring in a wider
  // panel), the book's name sits over its first letter (Thomas, 2026-11-16).
  createEffect(
    () => panel(),
    (section) => {
      if (section === undefined) return;
      const place = (): void => {
        const content = section.querySelector<HTMLElement>(".cm-content");
        if (content === null) return;
        const box = section.getBoundingClientRect();
        const text = content.getBoundingClientRect();
        const style = getComputedStyle(content);
        const start = text.left + Number.parseFloat(style.paddingLeft) - box.left;
        const end = box.right - (text.right - Number.parseFloat(style.paddingRight));
        section.style.setProperty("--text-start", `${Math.max(0, start)}px`);
        section.style.setProperty("--text-end", `${Math.max(0, end)}px`);
      };
      const watch = new ResizeObserver(place);
      watch.observe(section);
      // The editor mounts after the panel: watch for its content once, then
      // stop (typing must not re-measure). A remount (another book) re-runs
      // through `keyed` below, which replaces the content element.
      let seen: Element | null = null;
      const mounted = new MutationObserver(() => {
        const content = section.querySelector(".cm-content");
        if (content === null || content === seen) return;
        if (seen !== null) watch.unobserve(seen);
        seen = content;
        watch.observe(content);
        place();
      });
      mounted.observe(section, { childList: true, subtree: true });
      place();
      return () => {
        watch.disconnect();
        mounted.disconnect();
      };
    },
  );
  return (
    <section
      ref={setPanel}
      aria-label={m.refine_editor_label()}
      data-testid="refine-editor"
      // The page is grey; only the editor and the book menu are white. No
      // outline: the white is the edge. Line by line's own verse boxes sit
      // on the white.
      // As wide as the text and no wider: it fits its content, and the text
      // column caps itself at 60ch of the editor's font (editor.css), which a
      // width set here, in the interface's font, could not match.
      // Split, it sits in a column and grows DOWN (`flex-1`); alone, it
      // sits in a row, where `flex-1` would grow it across, so it keeps its
      // width there (`flex-none`) and the row's stretch gives it the height.
      class={cx(
        "mx-auto flex min-h-0 w-fit max-w-full flex-col rounded-lg bg-surface-primary",
        props.split === true ? "flex-1" : "flex-none",
      )}
    >
      {/* 12px top and bottom; each side lines up with the text's own edge
          (`--text-start`/`--text-end`, measured above; 3rem until then). The row is as wide as the
          panel and adds nothing to it (`w-0 min-w-full`): the text's 60ch
          sets the panel's width, and the bar fits inside it (Thomas,
          2026-11-16). */}
      {/* A rule under the bar in every view, line by line included: the
          panel's own 2px outline colour. */}
      <div class="shrink-0 border-b-2 border-surface-border ps-(--text-start,3rem) pe-(--text-end,3rem)">
        <div class="flex w-0 min-w-full items-center gap-controls py-3">
          {/* Where the reader is: the book and its chapter. */}
          <BookTitle />
          <span class="ms-auto" />
          {/* The Find box's way in from the page: one press opens it. */}
          <Button
            variant="tertiary"
            data-testid="refine-search"
            onClick={() => openFind("", undefined)}
          >
            <Search aria-hidden="true" />
            {m.refine_search_words()}
          </Button>
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
                      maxPixels={referenceCeiling}
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
                    <Resizable.Panel class="flex min-w-0 flex-col" minPixels={editorFloor}>
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

/**
 * A panel's width for `measure` (a `--editor-measure*` property, in `ch` of
 * the editor's own font) plus `sides` of fixed room: the text's padding, the
 * panel's own and the scrollbar. Measured, not computed: `ch` belongs to
 * whichever font the editor is showing. The split stops the handle at these
 * rather than letting the text scroll sideways (Thomas, 2026-11-16).
 */
const measured = (measure: string, sides: string): number => {
  const probe = document.createElement("div");
  probe.className = "cm-mode-regular";
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  const content = document.createElement("div");
  content.className = "cm-content";
  content.style.cssText = `width:calc(var(${measure}) + ${sides});padding:0;margin:0;min-width:0;max-width:none`;
  probe.append(content);
  (document.querySelector(".cm-host") ?? document.body).append(probe);
  const width = content.getBoundingClientRect().width;
  probe.remove();
  return Math.ceil(width);
};
/** The editor: its text's 3rem a side, the scrollbar inside the end one. 30–60ch. */
const editorFloor = (): number => measured("--editor-measure-min", "6rem");
/**
 * The reference: no floor of its own — it is what gives way when the two do
 * not fit (Thomas, 2026-11-16). No side padding on its text (Thomas, 2026-11-16); the column's 1.5rem end padding, the scrollbar. */
const REFERENCE_SIDES = "1.5rem + 12px";
const referenceCeiling = (): number => measured("--editor-measure", REFERENCE_SIDES);

export const Route = createFileRoute("/_app/project/$slug/book/$book")({
  head: () => ({ meta: [{ title: m.page_title({ page: m.page_book() }) }] }),
  component: () => {
    const params = Route.useParams();
    const shell = useShell();
    return (
      <BookPage root={shell.project()?.root ?? ""} bookId={decodeURIComponent(params().book)} />
    );
  },
});
