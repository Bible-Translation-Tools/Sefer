import { createAlignedGroup, type EditorBook } from "@sefer/editor";
import { createFileRoute } from "@tanstack/solid-router";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import { Show, createEffect, createSignal, untrack } from "solid-js";

import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { REFERENCE_WIDTH } from "#app/settings";
import { BookEditor } from "#app/ui/BookEditor";
import { Button, DelayedSpinner, Resizable, Switch, cx } from "#app/ui/primitives";
import { RecoveryBanner } from "#app/ui/recovery/RecoveryBanner";
import { AlignedProvider } from "#app/ui/workspace/aligned";
import { layout } from "#app/ui/workspace/layoutTweak";
import { ReferenceColumn } from "#app/ui/workspace/ReferenceColumn";
import { Toolbar } from "#app/ui/workspace/Toolbar";

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

/**
 * The panels layout's editor: the heart language, the only text that can be
 * edited, outlined on the page's white, the outline brand while it has focus.
 * A small action bar over the text: "Show reference" on the left (the only
 * way to the gateways — joined, there is none on screen), USFM flush right.
 * Split, its left border is the resize handle's line.
 */
function EditorPanel(props: { readonly book: EditorBook; readonly split?: boolean }) {
  const shell = useShell();
  /**
   * The bar's edges, matched to the TEXT's: CodeMirror centres the scripture
   * in a fixed measure beside its gutter, so the column moves with the
   * panel's width, the gutter and the font. Measured rather than restated —
   * the inset from each side of the panel to each side of `.cm-content`.
   */
  const [panel, setPanel] = createSignal<HTMLElement>();
  const [inset, setInset] = createSignal({ start: 24, end: 24 }, { name: "refineBarInset" });
  createEffect(
    // Again for a new book: its view is a new element.
    () => ({ section: panel(), book: props.book.id }),
    ({ section }) => {
      if (section === undefined) return;
      let watched: Element | undefined;
      const measure = (): void => {
        const text = section.querySelector(".cm-content");
        if (text === null) return;
        // Found: the view is up, and nothing else needs watching for it —
        // a subtree observer left on would measure on every keystroke.
        mounted.disconnect();
        if (text !== watched) {
          if (watched !== undefined) observer.unobserve(watched);
          watched = text;
          observer.observe(text);
        }
        const outer = section.getBoundingClientRect();
        const inner = text.getBoundingClientRect();
        const border = section.clientLeft;
        setInset({
          start: Math.max(0, Math.round(inner.left - outer.left - border)),
          end: Math.max(0, Math.round(outer.right - inner.right - border)),
        });
      };
      const observer = new ResizeObserver(measure);
      observer.observe(section);
      // The view mounts after the panel; catch it when it lands.
      const mounted = new MutationObserver(measure);
      mounted.observe(section, { childList: true, subtree: true });
      measure();
      return () => {
        observer.disconnect();
        mounted.disconnect();
      };
    },
  );
  return (
    <section
      ref={setPanel}
      aria-label={t("Refinement")}
      data-testid="refine-editor"
      class={cx(
        // The page's own white, outlined: the border goes brand while the
        // text has focus. Split, its left edge is also the resize handle's line.
        "flex min-h-0 flex-1 flex-col rounded-[12px] border-2 border-surface-border bg-surface-primary transition-colors focus-within:border-brand",
      )}
    >
      {/* 12px top and bottom; each side lines up with the text's own edge. */}
      <div
        class="flex shrink-0 items-center gap-controls py-3"
        style={{ "padding-inline": `${inset().start}px ${inset().end}px` }}
      >
        <Button
          variant="tertiary"
          data-testid="refine-reference"
          onClick={() => shell.setReferenceSplit(props.split !== true)}
        >
          <Show when={props.split === true} fallback={<PanelLeftOpen aria-hidden="true" />}>
            <PanelLeftClose aria-hidden="true" />
          </Show>
          {props.split === true ? t("Hide reference") : t("Show reference")}
        </Button>
        <Switch
          class="ms-auto"
          label={t("USFM")}
          checked={shell.mode() === "usfm"}
          onChange={(on) => shell.setMode(on ? "usfm" : "default")}
        />
      </div>
      <div class="flex min-h-0 flex-1 flex-col px-6">
        <Show when={props.book.id} keyed>
          <BookEditor book={props.book} bare />
        </Show>
      </div>
    </section>
  );
}

function BookPage(props: { readonly root: string; readonly bookId: string }) {
  const shell = useShell();
  // The page holds the editors' alignment: they each report where they are,
  // and it decides who follows (`@sefer/editor` `createAlignedGroup`). Reveal: a
  // pane moves only when the verse scrolled to is not already in its view.
  const aligned = createAlignedGroup("reveal");
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
  /** The column folded to its cards (its own collapse button). */
  const [folded, setFolded] = createSignal(false, { name: "referencesFolded" });
  const collapsed = (): boolean => references() === 0 || folded();
  /** Shut from the crumb strip's toggle: the column is gone and the editor has the row. */
  const shut = (): boolean => !shell.referenceOpen();

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

  const panels = (): boolean => layout() === "panels";
  /**
   * The panels layout's measure, shared by the toolbar and the panels under it
   * so their edges line up: one 800px column joined; split, 1624px for the two
   * panels and the 24px handle between them, shared as the handle sets.
   */
  const measure = (): string | undefined =>
    panels()
      ? cx("mx-auto w-full", shell.referenceSplit() ? "max-w-[1624px]" : "max-w-[800px]")
      : undefined;

  return (
    <main
      class={cx("flex h-full min-h-0 min-w-0 flex-col gap-3 p-6", panels() && "bg-surface-primary")}
      data-refine={layout()}
    >
      {/* Above everything, and on THIS route as well as the project page:
          unsaved work found on open is the first thing to answer, and opening
          a project now lands on the book rather than on the census, so a
          banner mounted only there is a banner nobody sees. */}
      <RecoveryBanner />
      {/* The editor waits for the recovery answer too: it is asked beside the
          analysis and lands first, so the banner above is never late. */}
      <Show
        when={shell.recoveryOffer() !== undefined ? shell.focused() : undefined}
        fallback={
          /* Opening a book parses it; blank unless a big one runs long. */
          <div class="h-full" data-opening={props.bookId}>
            <DelayedSpinner />
          </div>
        }
      >
        {(book) => (
          <>
            <div class={measure()}>
              <Toolbar panelToggle={!panels()} />
            </div>

            <Show
              when={layout() === "split"}
              fallback={
                // The language panels (a design tweak): one white surface.
                // Joined, only the heart language is on screen, in its editor
                // panel; split, the reference sits to its left, bare on the
                // page, under one language-and-text dropdown.
                //
                // NO aligned group: each side scrolls on its own, and the
                // gateways catch up when the reader clicks in the heart
                // language — the caret's paired-verse reveal in each pane.
                // Provided as `null`: none, said explicitly.
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
                        {/* The reference: no border, no surface, straight on
                            the page — only the editor beside it is a panel.
                            14px down: the editor's 2px outline and 12px
                            padding, so the two control rows share a line. */}
                        <Resizable.Panel
                          initialSize={referenceInitial}
                          minSize={referenceMin}
                          maxSize={referenceMax}
                          class="flex min-w-0 flex-col pe-6 pt-3.5"
                        >
                          <ReferenceColumn variant="gateway" onBound={setReferences} />
                        </Resizable.Panel>
                        {/* The editor's left border IS the handle: an edge
                            handle, nudged 1px so its 2px line lies exactly
                            over the border it lights up. */}
                        <Resizable.Handle
                          edge
                          class="translate-x-px"
                          label={t("Resize the reference panel")}
                        />
                        <Resizable.Panel class="flex min-w-0 flex-col">
                          <EditorPanel book={book()} split />
                        </Resizable.Panel>
                      </Resizable.Root>
                    </Show>
                  </div>
                </AlignedProvider>
              }
            >
              {/* The editor and its references are one aligned group: scroll
                either and a following pane brings the same verse into view. */}
              <AlignedProvider value={aligned}>
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
                    class={shut() ? "hidden" : collapsed() ? "[flex-basis:13rem]!" : undefined}
                  >
                    {/* Unmounted while shut, the panel kept: its panes are
                        editors, and nothing reads them while they are hidden. */}
                    <Show when={!shut()}>
                      <ReferenceColumn onBound={setReferences} onFolded={setFolded} />
                    </Show>
                  </Resizable.Panel>
                  {/* Hidden rather than unmounted, same reason as the panel. */}
                  <Resizable.Handle
                    label={t("Resize the reference pane")}
                    class={collapsed() || shut() ? "hidden" : undefined}
                  />
                  {/* No `<Card>` around the editor: `.editor-host` (app.css) IS
                  the card — white, bordered, 12px radius — and the scripture's
                  own generous padding is inside the view, where CodeMirror can
                  keep the measure at 40rem and centre it. A second card would
                  be a second border around the same rectangle. */}
                  <Resizable.Panel
                    class={cx(
                      // 7.5px each side of the 9px handle: 24px between the
                      // reference text and the editor, the page's own margin.
                      "flex flex-col gap-2 py-4 ps-[7.5px]",
                      // With the pane collapsed the editor takes the row back; the
                      // `!` is load-bearing because `Resizable.Panel` writes its
                      // share as an inline `flex-basis`.
                      collapsed() || shut() ? "grow! [flex-basis:auto]!" : undefined,
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
                  </Resizable.Panel>
                </Resizable.Root>
              </AlignedProvider>
            </Show>
          </>
        )}
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/_app/project/$slug/book/$book")({
  head: () => ({ meta: [{ title: "Sefer — book" }] }),
  // The project is already open: `project/$slug` did it. See the note there.
  component: () => {
    const params = Route.useParams();
    const shell = useShell();
    return (
      <BookPage root={shell.project()?.root ?? ""} bookId={decodeURIComponent(params().book)} />
    );
  },
});
