import { createAlignedGroup } from "@sefer/editor";
import { createFileRoute } from "@tanstack/solid-router";
import { Show, createEffect, createSignal, untrack } from "solid-js";

import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { REFERENCE_WIDTH } from "#app/settings";
import { BookEditor } from "#app/ui/BookEditor";
import { DelayedSpinner, Resizable, cx } from "#app/ui/primitives";
import { RecoveryBanner } from "#app/ui/recovery/RecoveryBanner";
import { AlignedProvider } from "#app/ui/workspace/aligned";
import { ReferenceColumn } from "#app/ui/workspace/ReferenceColumn";
import { Toolbar } from "#app/ui/workspace/Toolbar";

function BookPage(props: { readonly root: string; readonly bookId: string }) {
  const shell = useShell();
  const aligned = createAlignedGroup("reveal");
  const referenceInitial = untrack(() => shell.referenceWidth());
  const referenceMin = REFERENCE_WIDTH.min;
  const referenceMax = REFERENCE_WIDTH.max;

  const [references, setReferences] = createSignal(0, { name: "boundReferences" });
  const [folded, setFolded] = createSignal(false, { name: "referencesFolded" });
  const collapsed = (): boolean => references() === 0 || folded();
  const shut = (): boolean => !shell.referenceOpen();

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
    <main class="flex h-full min-h-0 min-w-0 flex-col gap-3 p-6">
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
            <Toolbar />

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
                  <Show when={!shut()}>
                    <ReferenceColumn onBound={setReferences} onFolded={setFolded} />
                  </Show>
                </Resizable.Panel>
                <Resizable.Handle
                  label={t("Resize the reference pane")}
                  class={collapsed() || shut() ? "hidden" : undefined}
                />
                <Resizable.Panel
                  class={cx(
                    "flex flex-col gap-2 py-4 ps-[7.5px]",
                    collapsed() || shut() ? "grow! [flex-basis:auto]!" : undefined,
                  )}
                >
                  <div class="flex min-h-0 flex-1 flex-col">
                    <Show when={book().id} keyed>
                      <BookEditor book={book()} />
                    </Show>
                  </div>
                </Resizable.Panel>
              </Resizable.Root>
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
