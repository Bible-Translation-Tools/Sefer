/**
 * The project sidebar: which project is open, and where in it you are.
 *
 * The mockups' "navigation dropdown" screen, built out of what the modules
 * already hold — the project's own book order, `ProjectAnalysis.census` for
 * the review pills, and the FOCUSED book's `structure().chapters` for the
 * grid. Nothing here reads text, and nothing here subscribes to a Book: every
 * derived number is re-read behind `shell.tick()`, which is the shell's whole
 * reactivity contract for derived products (documentation/architecture/shell.md).
 *
 * Only the focused book expands. That is not a collapse animation waiting to
 * be written: the chapter grid is about the book you are editing, and two
 * open grids would be two answers to "which chapter am I in".
 */

import { useNavigate } from "@tanstack/solid-router";
import BookIcon from "lucide-solid/icons/book";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import SearchIcon from "lucide-solid/icons/search";
import SettingsIcon from "lucide-solid/icons/settings";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { For, Show, createSignal } from "solid-js";

import { t } from "../../i18n";
import type { Shell } from "../../ProjectContext";
import { Input } from "../primitives";
import { bookName, parseReference, testamentOf, type Testament } from "./books";
import { bookPath, metadataOf, projectLanguage, projectName } from "./project";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly testament: Testament;
  readonly attention: number;
}

export interface ProjectSidebarProps {
  readonly shell: Shell;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const navigate = useNavigate();
  const shell = () => props.shell;
  const [query, setQuery] = createSignal("", { name: "sidebarQuery" });

  const go = (to: string): void => {
    // SAFETY: the book path is built at runtime from a project root and a book
    // id, which no route literal union can spell. An unresolvable path is the
    // router's own not-found, never a crash — the same trade
    // `ProjectContext.go` makes for every navigation a command performs.
    void navigate({ to: to as never });
  };

  const rows = (): readonly Row[] => {
    shell().tick();
    const project = shell().project();
    if (project === undefined) return [];
    const metadata = metadataOf(project);
    const census = new Map(
      shell()
        .services.projectAnalysis.census(project)
        .map((book) => [book.bookId, book.diagnostics]),
    );
    return project.books.map((book) => {
      const diagnostics = census.get(book.id);
      return {
        id: book.id,
        name: bookName(book.id, metadata),
        testament: testamentOf(book.id),
        attention: (diagnostics?.errors ?? 0) + (diagnostics?.warnings ?? 0),
      };
    });
  };

  const section = (testament: Testament): readonly Row[] =>
    rows().filter((row) => row.testament === testament);

  /** The chapters of the book the editor is showing — the only expandable one. */
  const chapters = (): readonly string[] => {
    shell().tick();
    const book = shell().focused();
    return book === undefined ? [] : book.structure().chapters.map((chapter) => chapter.label);
  };

  const openBook = (bookId: string): void => {
    const project = shell().project();
    if (project === undefined) return;
    go(bookPath(project.root, bookId));
  };

  const jump = (): void => {
    const project = shell().project();
    if (project === undefined) return;
    const found = parseReference(
      query(),
      project.books.map((book) => book.id),
    );
    if (found === undefined) {
      shell().report(t("no book matches {query}", { query: query() }));
      return;
    }
    // The chapter is set before the navigation so the book opens on it: the
    // route's own effect calls `focus`, which reads the shell, not the URL.
    if (found.chapter !== undefined) shell().setChapter(found.chapter - 1);
    openBook(found.bookId);
    setQuery("");
  };

  const BookRow = (rowProps: { readonly row: Row }) => {
    const focused = (): boolean => shell().focused()?.id === rowProps.row.id;
    return (
      <li>
        <button
          type="button"
          data-book={rowProps.row.id}
          data-focused={focused() ? "" : undefined}
          class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-small transition-colors data-focused:bg-sidebar-surface-active data-focused:font-medium data-focused:text-brand not-data-focused:text-sidebar-on-surface not-data-focused:hover:bg-sidebar-surface-hover"
          onClick={() => openBook(rowProps.row.id)}
        >
          <BookIcon size={15} aria-hidden="true" class="shrink-0" />
          <span class="truncate">{rowProps.row.name}</span>
          <Show when={rowProps.row.attention > 0}>
            <span class="ms-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-warning px-1.5 py-0.5 text-smallest font-medium text-on-surface-warning">
              <TriangleAlert size={11} aria-hidden="true" />
              {t("Review")}
            </span>
          </Show>
          <span
            aria-hidden="true"
            class={rowProps.row.attention > 0 ? "shrink-0" : "ms-auto shrink-0"}
          >
            <Show when={focused()} fallback={<ChevronRight size={14} />}>
              <ChevronDown size={14} />
            </Show>
          </span>
        </button>

        <Show when={focused() && chapters().length > 0}>
          <ol class="mt-1 mb-2 grid grid-cols-4 gap-1 ps-7 pe-2">
            <For each={chapters()}>
              {(label, index) => (
                <li>
                  <button
                    type="button"
                    data-chapter={index()}
                    data-current={shell().chapter() === index() ? "" : undefined}
                    class="w-full cursor-pointer rounded-md border border-transparent py-1 text-center text-smallest tabular-nums transition-colors data-current:border-brand data-current:bg-brand-light data-current:font-semibold data-current:text-brand not-data-current:text-on-surface-secondary not-data-current:hover:bg-sidebar-surface-hover"
                    onClick={() => shell().setChapter(index())}
                  >
                    {label}
                  </button>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </li>
    );
  };

  const Section = (sectionProps: { readonly label: string; readonly rows: readonly Row[] }) => (
    <Show when={sectionProps.rows.length > 0}>
      <li class="px-2 pt-3 pb-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase">
        {sectionProps.label}
      </li>
      <For each={sectionProps.rows}>{(row) => <BookRow row={row} />}</For>
    </Show>
  );

  return (
    <div class="flex h-full flex-col border-e border-sidebar-border bg-sidebar-surface">
      <div class="p-3 pb-2">
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-surface-border bg-surface-primary px-3 py-2 text-start transition-colors hover:bg-sidebar-surface-hover"
          onClick={() => go("/projects")}
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-small font-bold text-on-surface-primary">
              <Show when={shell().project()} fallback={t("No project open")}>
                {projectName(shell().project())}
              </Show>
            </span>
            <Show when={projectLanguage(shell().project()) !== ""}>
              <span class="block truncate text-smallest text-on-surface-tertiary">
                {projectLanguage(shell().project())}
              </span>
            </Show>
          </span>
          <ChevronDown size={16} aria-hidden="true" class="shrink-0 text-on-surface-tertiary" />
        </button>
      </div>

      <div class="px-3 pb-2">
        <Input
          size="sm"
          type="search"
          icon={<SearchIcon size={14} />}
          aria-label={t("Go to a book or chapter")}
          placeholder={t("Search 'Luke 1'…")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            jump();
          }}
        />
      </div>

      <nav aria-label={t("Books")} class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <Show
          when={rows().length > 0}
          fallback={
            <p class="px-2 py-4 text-small text-on-surface-tertiary">
              {t("This project has no books yet.")}
            </p>
          }
        >
          <ul>
            <Section label={t("Old Testament")} rows={section("ot")} />
            <Section label={t("New Testament")} rows={section("nt")} />
          </ul>
        </Show>
      </nav>

      <footer class="border-t border-sidebar-border p-3">
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-small text-sidebar-on-surface-muted transition-colors hover:bg-sidebar-surface-hover hover:text-sidebar-on-surface"
          onClick={() => go("/settings")}
        >
          <SettingsIcon size={15} aria-hidden="true" />
          {t("Settings")}
        </button>
        {/* TODO(seam): the "Update available" pill the mockup puts here. The
            `Updater` port only answers on demand (`check()` is an Effect that
            reaches the network), and there is no signal to read — polling it
            from the sidebar would make every project a background request.
            It wants a checked-once-at-start value on the shell first. */}
      </footer>
    </div>
  );
}
