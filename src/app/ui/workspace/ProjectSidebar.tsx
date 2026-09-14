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

import { useNavigate, useRouterState } from "@tanstack/solid-router";
import BookIcon from "lucide-solid/icons/book";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import FolderClock from "lucide-solid/icons/folder-clock";
import SearchIcon from "lucide-solid/icons/search";
import SettingsIcon from "lucide-solid/icons/settings";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { For, Show, createEffect, createSignal } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Badge, Input } from "../primitives";
import { bookName, parseReference, testamentOf, type Testament } from "./books";
import { bookPath, metadataOf, projectLanguage, projectName, projectPath } from "./project";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly testament: Testament;
  readonly attention: number;
}

export function ProjectSidebar() {
  const navigate = useNavigate();
  const shell = useShell();
  const [query, setQuery] = createSignal("", { name: "sidebarQuery" });
  // A reference typed with a chapter ("Luke 1") names a place in a book that is
  // not open yet. Setting the clip before navigating does not survive: the
  // route's effect calls `focus`, and `focus` decides the opening chapter
  // itself (`editor.preferChapterView`). So the chapter is REMEMBERED and
  // applied once the book it names is the focused one.
  const [pending, setPending] = createSignal<
    { readonly bookId: string; readonly chapter: number } | undefined
  >(undefined, { name: "pendingChapter" });

  createEffect(
    () => ({ focused: shell.focused()?.id, want: pending() }),
    ({ focused, want }) => {
      if (want === undefined || focused === undefined || focused !== want.bookId) return;
      setPending(undefined);
      // By LABEL, not by index: the engine's first chapter row is the front
      // matter, so "3" is not necessarily the third row.
      const at = shell
        .focused()
        ?.structure()
        .chapters.findIndex((chapter) => chapter.label === String(want.chapter));
      if (at !== undefined && at >= 0) shell.setChapter(at);
    },
  );

  const go = (to: string): void => {
    // SAFETY: the book path is built at runtime from a project root and a book
    // id, which no route literal union can spell. An unresolvable path is the
    // router's own not-found, never a crash — the same trade
    // `ProjectContext.go` makes for every navigation a command performs.
    void navigate({ to: to as never });
  };

  const rows = (): readonly Row[] => {
    shell.tick();
    const project = shell.project();
    if (project === undefined) return [];
    const metadata = metadataOf(project);
    const counted = new Map(
      shell.services.projectAnalysis
        .census(project)
        .map((book) => [book.bookId, book.diagnostics] as const),
    );
    return project.books.map((book) => {
      const diagnostics = counted.get(book.id);
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

  /**
   * The chapters of the book the editor is showing — the only expandable one.
   *
   * `index` is carried rather than derived, because the engine's chapter table
   * begins with the FRONT MATTER: everything before the first chapter marker is
   * its own row with an empty label. That row is a real clip target — it is
   * what the identification and the table of contents live in — but it is not a
   * chapter, so the grid drops it and keeps the index the editor clips by.
   */
  const chapters = (): readonly { readonly index: number; readonly label: string }[] => {
    shell.tick();
    const book = shell.focused();
    if (book === undefined) return [];
    const rows: { index: number; label: string }[] = [];
    book.structure().chapters.forEach((chapter, index) => {
      if (chapter.label !== "") rows.push({ index, label: chapter.label });
    });
    return rows;
  };

  const openBook = (bookId: string): void => {
    const project = shell.project();
    if (project === undefined) return;
    go(bookPath(project.root, bookId));
  };

  const jump = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    const found = parseReference(
      query(),
      project.books.map((book) => book.id),
    );
    if (found === undefined) {
      shell.report(t("no book matches {query}", { query: query() }));
      return;
    }
    setPending(
      found.chapter === undefined ? undefined : { bookId: found.bookId, chapter: found.chapter },
    );
    openBook(found.bookId);
    setQuery("");
  };

  const BookRow = (rowProps: { readonly row: Row }) => {
    const focused = (): boolean => shell.focused()?.id === rowProps.row.id;
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
          <span class="min-w-0 flex-1 truncate">{rowProps.row.name}</span>
          <Show when={rowProps.row.attention > 0}>
            {/* The word goes when the pane is narrow and the triangle stays: a
                truncated book name costs the reader more than the label does. */}
            <span
              title={t("This book has findings to review.")}
              class="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-warning px-1.5 py-0.5 text-smallest font-medium text-on-surface-warning"
            >
              <TriangleAlert size={11} aria-hidden="true" />
              <span class="hidden @min-[13rem]:inline">{t("Review")}</span>
            </span>
          </Show>
          <span aria-hidden="true" class="shrink-0">
            <Show when={focused()} fallback={<ChevronRight size={14} />}>
              <ChevronDown size={14} />
            </Show>
          </span>
        </button>

        <Show when={focused() && chapters().length > 0}>
          <ol class="mt-1 mb-2 grid grid-cols-4 gap-1 ps-7 pe-2">
            <For each={chapters()}>
              {(chapter) => (
                <li>
                  <button
                    type="button"
                    data-chapter={chapter.index}
                    data-current={shell.chapter() === chapter.index ? "" : undefined}
                    class="w-full cursor-pointer rounded-md border py-1 text-center text-smallest tabular-nums transition-colors data-current:border-brand data-current:bg-brand-light data-current:font-semibold data-current:text-brand not-data-current:border-surface-border not-data-current:bg-surface-primary not-data-current:text-on-surface-secondary not-data-current:hover:bg-sidebar-surface-hover"
                    onClick={() => shell.setChapter(chapter.index)}
                  >
                    {chapter.label}
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

  /**
   * With no project open, the panel is the way back into one.
   *
   * The book list and the reference box both need a project to mean anything —
   * an empty list under a search box that searches it is the panel saying
   * nothing twice. `shell.recentProjects` is what the landing screen wrote as
   * it opened each one, so this is a history and not a directory listing; when
   * it is empty there is nothing to show and the shell collapses the panel
   * altogether (`shell.sidebarShowing`).
   */
  const Recents = () => (
    <nav aria-label={t("Recent projects")} class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      <p class="px-2 pt-3 pb-1 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase">
        {t("Recent projects")}
      </p>
      <ul>
        <For each={shell.recentProjects()}>
          {(recent) => (
            <li>
              <button
                type="button"
                data-recent={recent.root}
                class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-small text-sidebar-on-surface transition-colors hover:bg-sidebar-surface-hover"
                onClick={() => go(projectPath(recent.root))}
              >
                <FolderClock size={15} aria-hidden="true" class="shrink-0" />
                <span class="min-w-0 flex-1 truncate">{recent.name}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
      <button
        type="button"
        class="mt-2 w-full cursor-pointer rounded-md px-2 py-1.5 text-start text-small text-brand transition-colors hover:bg-sidebar-surface-hover"
        onClick={() => go("/projects")}
      >
        {t("All projects")}
      </button>
    </nav>
  );

  /**
   * Is the reader on the projects side of the app? `/start/*` is the landing
   * screen's second half — bringing a project in — so the chooser is the
   * current place there too, and marking only `/projects` would make the
   * sidebar disagree with the screen.
   */
  const path = useRouterState({ select: (state) => state.location.pathname });
  const choosing = (): boolean => path().startsWith("/projects") || path().startsWith("/start");

  return (
    <div class="flex h-full flex-col border-e border-sidebar-border bg-sidebar-surface">
      <div class="p-3 pb-2">
        <button
          type="button"
          data-current={choosing() ? "" : undefined}
          class="flex w-full cursor-pointer items-center gap-2 rounded-lg border bg-surface-primary px-3 py-2 text-start transition-colors hover:bg-sidebar-surface-hover data-current:border-brand data-current:bg-brand-light not-data-current:border-surface-border"
          onClick={() => go("/projects")}
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-small font-bold text-on-surface-primary">
              <Show when={shell.project()} fallback={t("No project open")}>
                {projectName(shell.project())}
              </Show>
            </span>
            <Show when={projectLanguage(shell.project()) !== ""}>
              <span class="block truncate text-smallest text-on-surface-tertiary">
                {projectLanguage(shell.project())}
              </span>
            </Show>
          </span>
          <ChevronDown size={16} aria-hidden="true" class="shrink-0 text-on-surface-tertiary" />
        </button>
      </div>

      <Show when={shell.project()} fallback={<Recents />}>
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

        <nav aria-label={t("Books")} class="@container min-h-0 flex-1 overflow-y-auto px-3 pb-3">
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
      </Show>

      <footer class="border-t border-sidebar-border p-3">
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-small text-sidebar-on-surface-muted transition-colors hover:bg-sidebar-surface-hover hover:text-sidebar-on-surface"
          onClick={() => go("/settings")}
        >
          <SettingsIcon size={15} aria-hidden="true" />
          {t("Settings")}
        </button>
        {/* The mockup's "Update available" pill. `shell.updateAvailable` is one
            `Updater.check()` per session, on the desktop host, a few seconds
            after boot — the sidebar reads an answer rather than asking, which
            is what keeps a footer from making a network request per render. */}
        <Show when={shell.updateAvailable()}>
          <p class="px-2 pt-2">
            <Badge tone="brand">{t("Update available")}</Badge>
          </p>
        </Show>
      </footer>
    </div>
  );
}
