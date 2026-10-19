import { createAlignedGroup } from "@sefer/editor";
import { createFileRoute } from "@tanstack/solid-router";
import Columns2 from "lucide-solid/icons/columns-2";
import Combine from "lucide-solid/icons/combine";
import { Show, createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { t } from "#app/i18n";
import { languageName, languageTag } from "#app/language";
import { useShell } from "#app/ProjectContext";
import { REFERENCE_WIDTH } from "#app/settings";
import { BookEditor } from "#app/ui/BookEditor";
import { DelayedSpinner, IconButton, Resizable, cx } from "#app/ui/primitives";
import { RecoveryBanner } from "#app/ui/recovery/RecoveryBanner";
import { AlignedProvider } from "#app/ui/workspace/aligned";
import { metadataOf, projectName } from "#app/ui/workspace/project";
import { LanguageTab, ReferenceColumn } from "#app/ui/workspace/ReferenceColumn";
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

  /**
   * How the reference text and the editor relate — a DESIGN TWEAK, scaffolding
   * until the question is settled (`pnpm design:scaffolding` lists it):
   * `split`, the reference column beside the editor card (what ships), or
   * `panels`: everything straight on one white surface, the languages as TABS
   * in one panel — the gateways read-only, the heart language last and the
   * only one editable — which can split so the gateways get a panel of their
   * own (`shell.referenceSplit`, remembered), and the project panel folds to
   * a book button. Builds without the design surface are always `split`.
   */
  // `ownedWrite`: the panel calls `onChange` once as the tweak registers,
  // which is while this page is being built.
  const [layout, setLayoutSignal] = createSignal<"split" | "panels">("split", {
    name: "refineLayout",
    ownedWrite: true,
  });
  // SAFETY: under `__SEFER_DESIGN__` the design surface installs this handle
  // (`src/dev/designSurface.ts`) with `register` and `set` of these shapes;
  // `unknown` in the global's type only because platform may not import a dev tool.
  const design = (__SEFER_DESIGN__ ? globalThis.__sefer?.design : undefined) as
    | {
        readonly register?: (registration: {
          readonly namespace: string;
          readonly tweaks: readonly {
            readonly key: string;
            readonly label: string;
            readonly kind: "choice";
            readonly options: readonly string[];
          }[];
          readonly onChange: (values: Readonly<Record<string, string>>) => void;
        }) => () => void;
        readonly set?: (key: string, value: string) => void;
      }
    | undefined;
  if (__SEFER_DESIGN__) {
    const release = design?.register?.({
      namespace: "refine",
      tweaks: [{ key: "layout", label: "Layout", kind: "choice", options: ["split", "panels"] }],
      onChange: (values) => {
        setLayoutSignal(values["refine.layout"] === "panels" ? "panels" : "split");
      },
    });
    if (release !== undefined) onCleanup(release);
  }
  /** The joined panel's heart-language tab is the one on show, not a gateway. */
  const [heartActive, setHeartActive] = createSignal(true, { name: "refineHeartActive" });
  /** The heart language: the project's own, by name and by tag. */
  const heart = () => {
    const metadata = metadataOf(shell.project());
    const code = languageTag(metadata);
    return {
      name: languageName(metadata) || projectName(shell.project()),
      code: code || projectName(shell.project()),
    };
  };
  const panels = (): boolean => layout() === "panels";

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
            <Toolbar usfm={panels()} bookFab={panels()} />

            <Show
              when={layout() === "split"}
              fallback={
                // The language panels (a design tweak): one white surface, no
                // cards. Joined, every language is a tab of ONE panel; split,
                // the gateways have a panel of their own beside the heart
                // language. Each panel keeps its tabs' places by hiding the
                // ones not on show rather than unmounting them.
                //
                // NO aligned group: each side scrolls on its own, and the
                // gateways catch up when the reader clicks in the heart
                // language — the caret's paired-verse reveal in each pane.
                // Provided as `null`: none, said explicitly.
                <AlignedProvider value={null}>
                  <div class="flex min-h-0 flex-1 gap-6">
                    <Show
                      when={shell.referenceSplit()}
                      fallback={
                        <ReferenceColumn
                          variant="panel"
                          onBound={setReferences}
                          heart={{ ...heart(), active: heartActive(), onActivate: setHeartActive }}
                          editor={
                            <Show when={book().id} keyed>
                              <BookEditor book={book()} bare />
                            </Show>
                          }
                          trailing={
                            <IconButton
                              variant="quiet"
                              data-testid="refine-split"
                              label={t("Move the gateway languages to their own panel")}
                              icon={<Columns2 />}
                              onClick={() => shell.setReferenceSplit(true)}
                            />
                          }
                        />
                      }
                    >
                      <Resizable.Root
                        class="min-h-0 min-w-0 flex-1"
                        onSizesChange={(sizes) => {
                          const first = sizes[0];
                          if (first !== undefined) shell.setReferenceWidth(first);
                        }}
                      >
                        <Resizable.Panel
                          initialSize={referenceInitial}
                          minSize={referenceMin}
                          maxSize={referenceMax}
                          class="flex min-w-0 flex-col"
                        >
                          <ReferenceColumn variant="panel" onBound={setReferences} />
                        </Resizable.Panel>
                        {/* Nothing between the panels at rest; the line and
                            its grip come up under the pointer. 24px wide, the
                            page's own margin. */}
                        <Resizable.Handle
                          quiet
                          class="px-3"
                          label={t("Resize the gateway languages panel")}
                        />
                        <Resizable.Panel class="flex min-w-0 flex-col">
                          {/* At most 800px, centred, as the gateways' panel is. */}
                          <div class="mx-auto flex min-h-0 w-full max-w-[800px] flex-1 flex-col gap-3">
                            <div
                              role="tablist"
                              aria-label={t("Languages")}
                              class="flex shrink-0 items-center gap-controls border-b border-surface-border"
                            >
                              <div class="flex min-w-0 flex-1 items-end">
                                <LanguageTab
                                  testId="language-tab-heart"
                                  name={heart().name}
                                  code={heart().code}
                                  refining
                                  active
                                />
                              </div>
                              <IconButton
                                variant="quiet"
                                data-testid="refine-join"
                                label={t("Join the gateway languages back into this panel")}
                                icon={<Combine />}
                                onClick={() => shell.setReferenceSplit(false)}
                              />
                            </div>
                            <div class="flex min-h-0 flex-1 flex-col">
                              <Show when={book().id} keyed>
                                <BookEditor book={book()} bare />
                              </Show>
                            </div>
                          </div>
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
