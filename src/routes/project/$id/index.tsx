import { Link, createFileRoute, useNavigate } from "@tanstack/solid-router";
import { For, Show, createEffect, createSignal, untrack } from "solid-js";

import { runCommand } from "../../../app/commands";
import { t } from "../../../app/i18n";
import { useShell } from "../../../app/ProjectContext";
import { CloudPanel } from "../../../app/ui/CloudPanel";
import { Badge, Button, Card, PanelHeader } from "../../../app/ui/primitives";
import { RecoveryBanner } from "../../../app/ui/recovery/RecoveryBanner";
import { ShellGate } from "../../../app/ui/ShellGate";

/**
 * One project: the book census, and which books have unsaved work.
 *
 * Both come straight from the shell's stores — `shell.bookCensus()` and
 * `shell.saveState(book)` — which the coordinator wrote when an event said
 * those books moved. Neither is recomputed here, and an edit made in the
 * editor route reaches this page because the row it changed is the row this
 * page reads.
 */

function ProjectPage(props: { readonly root: string; readonly census: boolean }) {
  const shell = useShell();
  const navigate = useNavigate();
  const [opening, setOpening] = createSignal(false);

  /**
   * Opening a project lands on the WORK, not on a census.
   *
   * A translator who opens a project every morning was being shown a list of
   * books and asked to find their own place in it. `shell.lastLocation` is
   * where they were; this route forwards to it, and the census is one click
   * away on the location bar's book crumb, which arrives with `?books=1` and
   * therefore does not bounce.
   *
   * The remembered book is checked against the project HERE, because this is
   * the first moment it is open: a book that has since been removed falls back
   * to the census rather than to a not-found.
   */
  createEffect(
    () => ({ root: props.root, census: props.census, held: shell.project() }),
    ({ root, census, held }) => {
      if (census || held === undefined || held.root !== root) return;
      // Untracked: an effect's callback does not track in Solid 2, and asking
      // it to would be wrong anyway — this reads where the reader WAS at the
      // moment the project opened, not a place that then follows them around.
      const where = untrack(() => shell.lastLocation(root));
      if (where === undefined || !held.books.some((book) => book.id === where.bookId)) return;
      void navigate({
        to: "/project/$id/book/$book",
        params: { id: encodeURIComponent(root), book: encodeURIComponent(where.bookId) },
        replace: true,
      });
    },
  );

  // Deep-linking is honest here: the route names a root, so a project that is
  // not the open one is opened rather than reported as missing. An effect on
  // the param rather than a call at setup, because navigating to a different
  // project does not recreate this component.
  createEffect(
    () => props.root,
    (root) => {
      if (untrack(() => shell.project()?.root) === root) return;
      setOpening(true);
      void shell.openProject(root).finally(() => setOpening(false));
    },
  );

  // The shell's census, not `ProjectAnalysis`'s: the same rows, held from the
  // last Publication instead of rebuilt on every read. Rebuilding it meant
  // materialising every finding in every book to count two of them, and behind
  // `tick` this page did that on every keystroke typed in another route.
  const census = () => shell.bookCensus();

  const dirty = (bookId: string): boolean => {
    const book = shell.project()?.book(bookId);
    return book !== undefined && shell.unsaved(book);
  };

  return (
    <main class="min-w-0 space-y-4 p-6">
      {/* Above the header on purpose: an unsaved backup found on open is the
          first thing to answer, before the census says how the project looks. */}
      <RecoveryBanner />
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

interface ProjectSearch {
  readonly books?: boolean;
}

export const Route = createFileRoute("/project/$id/")({
  /**
   * `?books=1` asks for the census itself and suppresses the forward to the
   * last location. Every other arrival is an Open, and an Open means "take me
   * back to my work".
   */
  validateSearch: (search: Record<string, unknown>): ProjectSearch =>
    search.books === true || search.books === "1" || search.books === 1 ? { books: true } : {},
  head: () => ({ meta: [{ title: "Sefer — project" }] }),
  component: () => {
    const params = Route.useParams();
    const search = Route.useSearch();
    return (
      <ShellGate>
        {() => (
          <ProjectPage root={decodeURIComponent(params().id)} census={search().books === true} />
        )}
      </ShellGate>
    );
  },
});
