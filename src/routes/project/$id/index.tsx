import { Link, createFileRoute } from "@tanstack/solid-router";
import { For, Show, createEffect, createSignal } from "solid-js";

import { runCommand } from "../../../app/commands";
import { t } from "../../../app/i18n";
import { useShell } from "../../../app/ProjectContext";
import { CloudPanel } from "../../../app/ui/CloudPanel";
import { Badge, Button, Card, PanelHeader } from "../../../app/ui/primitives";
import { ShellGate } from "../../../app/ui/ShellGate";

/**
 * One project: the book census, and which books have unsaved work.
 *
 * Both come straight from the modules — `ProjectAnalysis.census(project)` and
 * `SaveCoordinator.dirty(book)` — and both are synchronous reads of things
 * already in memory. Neither is recomputed here; the page reads
 * `shell.tick()` so that an edit made in the editor route re-renders it, which
 * is the whole of the shell's reactivity contract for derived products.
 */

function ProjectPage(props: { readonly root: string }) {
  const shell = useShell();
  const [opening, setOpening] = createSignal(false);

  // Deep-linking is honest here: the route names a root, so a project that is
  // not the open one is opened rather than reported as missing. An effect on
  // the param rather than a call at setup, because navigating to a different
  // project does not recreate this component.
  createEffect(
    () => props.root,
    (root) => {
      if (shell.project()?.root === root) return;
      setOpening(true);
      void shell.openProject(root).finally(() => setOpening(false));
    },
  );

  const census = () => {
    shell.tick();
    const project = shell.project();
    return project === undefined ? [] : shell.services.projectAnalysis.census(project);
  };

  const dirty = (bookId: string): boolean => {
    const book = shell.project()?.book(bookId);
    return book !== undefined && shell.unsaved(book);
  };

  return (
    <main class="min-w-0 space-y-4 p-6">
      {/* RecoveryBanner mounts here after merge —
          `<RecoveryBanner root={props.root} />` from
          `src/app/ui/recovery/RecoveryBanner.tsx`, which is being built on
          another branch. It goes ABOVE the header on purpose: an unsaved
          backup found on open is the first thing to answer, before the census
          says how the project looks (design-direction.md, gap list 6). */}
      <PanelHeader title={t("Project")} subtitle={props.root} />

      <Show
        when={shell.project()}
        fallback={
          <p class="text-small text-on-surface-tertiary">
            {opening() ? t("Opening…") : shell.status()}
          </p>
        }
      >
        {(project) => (
          <>
            <Card class="flex flex-wrap items-center gap-2">
              <Button onClick={() => runCommand("project.saveAll")}>{t("Save all")}</Button>
              <Button onClick={() => runCommand("git.commit")}>{t("Commit")}</Button>
              <span class="ms-auto text-small text-on-surface-tertiary">
                {t("{count} books", { count: project().books.length })}
              </span>
            </Card>

            <ul class="flex flex-col gap-2" data-books={project().books.length}>
              <For each={census()}>
                {(book) => (
                  <li data-book={book.bookId}>
                    <Card class="flex flex-wrap items-center gap-3">
                      <Link
                        to="/project/$id/book/$book"
                        params={{
                          id: encodeURIComponent(props.root),
                          book: encodeURIComponent(book.bookId),
                        }}
                        class="font-semibold text-brand no-underline hover:underline"
                      >
                        {book.bookId}
                      </Link>
                      <span class="text-small text-on-surface-tertiary">
                        {t("{chapters} ch · {verses} vv", {
                          chapters: book.chapters,
                          verses: book.verses,
                        })}
                      </span>
                      <Show when={book.diagnostics.errors > 0}>
                        <Badge tone="error">{book.diagnostics.errors}</Badge>
                      </Show>
                      <Show when={book.diagnostics.warnings > 0}>
                        <Badge tone="warning">{book.diagnostics.warnings}</Badge>
                      </Show>
                      <Show when={dirty(book.bookId)}>
                        <Badge tone="brand" class="ms-auto">
                          {t("unsaved")}
                        </Badge>
                      </Show>
                    </Card>
                  </li>
                )}
              </For>
            </ul>

            {/* Remote sync, below the census: it acts on the whole project,
                and it is the one panel here that can be offline. */}
            <CloudPanel root={props.root} />

            <Show when={project().failed.length > 0}>
              <p class="rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error">
                {t("{count} file(s) did not become books.", { count: project().failed.length })}
              </p>
            </Show>
          </>
        )}
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/project/$id/")({
  head: () => ({ meta: [{ title: "Sefer — project" }] }),
  component: () => {
    const params = Route.useParams();
    return <ShellGate>{() => <ProjectPage root={decodeURIComponent(params().id)} />}</ShellGate>;
  },
});
