import { Link, createFileRoute } from "@tanstack/solid-router";
import { For, Show, createEffect, createSignal } from "solid-js";

import { runCommand } from "../../../app/commands";
import { t } from "../../../app/i18n";
import { useShell } from "../../../app/ProjectContext";
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
    <main>
      <header>
        <h2>{t("Project")}</h2>
        <code class="muted spacer">{props.root}</code>
      </header>

      <Show
        when={shell.project()}
        fallback={<p class="muted">{opening() ? t("Opening…") : shell.status()}</p>}
      >
        {(project) => (
          <>
            <div class="row">
              <button type="button" onClick={() => runCommand("project.saveAll")}>
                {t("Save all")}
              </button>
              <button type="button" onClick={() => runCommand("git.commit")}>
                {t("Commit")}
              </button>
              <span class="muted spacer">
                {t("{count} books", { count: project().books.length })}
              </span>
            </div>

            <ul class="list" data-books={project().books.length}>
              <For each={census()}>
                {(book) => (
                  <li data-book={book.bookId}>
                    <Link
                      to="/project/$id/book/$book"
                      params={{
                        id: encodeURIComponent(props.root),
                        book: encodeURIComponent(book.bookId),
                      }}
                    >
                      <strong>{book.bookId}</strong>
                    </Link>
                    <span class="muted">
                      {t("{chapters} ch · {verses} vv", {
                        chapters: book.chapters,
                        verses: book.verses,
                      })}
                    </span>
                    <Show when={book.diagnostics.errors > 0}>
                      <span class="badge" data-severity="error">
                        {book.diagnostics.errors}
                      </span>
                    </Show>
                    <Show when={book.diagnostics.warnings > 0}>
                      <span class="badge" data-severity="warning">
                        {book.diagnostics.warnings}
                      </span>
                    </Show>
                    <Show when={dirty(book.bookId)}>
                      <span class="badge spacer" data-dirty="true">
                        {t("unsaved")}
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>

            <Show when={project().failed.length > 0}>
              <p class="problem">
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
