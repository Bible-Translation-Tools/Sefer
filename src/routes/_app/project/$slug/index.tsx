import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Show, createEffect, untrack } from "solid-js";

import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";

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

  // In the effect's apply half: navigating writes the router's stores, refused in an owned scope.
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
