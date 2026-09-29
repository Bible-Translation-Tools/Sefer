import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Show, createEffect, untrack } from "solid-js";

import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";

/**
 * `/project/$slug` is not a screen. It is the door to the work: the book the
 * reader was last in, or — when that book is gone from the project, or they
 * have never been in one — the project's first book.
 *
 * Every "take me to my work" in the app (the app bar's home, Back to editor,
 * `/`) points here, so this is the one place that decision is made.
 *
 * Decided once, at mount, and drawn as nothing: the parent route
 * (`project/$slug`) renders this only after the project the URL names is
 * open, so the answer is already known at mount and there is nothing to wait
 * for and nothing to flash.
 *
 * A project with no books has nowhere to go, and says so. Drafting a book
 * from nothing is not built yet.
 */

function ProjectDoor() {
  const shell = useShell();
  const navigate = useNavigate();

  const target = untrack((): string | undefined => {
    const project = shell.project();
    if (project === undefined) return undefined;
    const remembered = shell.lastLocation(project.root)?.bookId;
    if (remembered !== undefined && project.book(remembered) !== undefined) return remembered;
    return project.books[0]?.id;
  });

  // In an effect's apply half, not the body: navigating writes the router's
  // stores, and Solid 2 refuses a write inside a component's owned scope.
  // Untracked, because building the location reads the router's own state.
  createEffect(
    () => target,
    (book) => {
      if (book === undefined) return;
      untrack(() => {
        void navigate({
          to: "/project/$slug/book/$book",
          params: { slug: shell.slug(), book: encodeURIComponent(book) },
          replace: true,
        });
      });
    },
  );

  return (
    <Show when={target === undefined}>
      <main data-testid="empty-project" class="p-6 text-small text-on-surface-tertiary">
        {t("This project has no books yet.")}
      </main>
    </Show>
  );
}

export const Route = createFileRoute("/_app/project/$slug/")({
  head: () => ({ meta: [{ title: "Sefer — project" }] }),
  component: ProjectDoor,
});
