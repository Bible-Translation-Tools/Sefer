/**
 * The project sidebar: which project is open, and where in it you are.
 *
 * Top to bottom: the project (name, and language with its code); a search box
 * that ONLY filters the list below it — it never navigates; a testament
 * switch; and the books of that testament as an accordion, each opening onto
 * a four-column grid of its chapters.
 *
 * The focused book's grid comes from the editor's own chapter table
 * (`shell.outline`), which knows about front matter. Any other book is Plain,
 * with no parsed structure, so its grid is counted from its `\c` markers —
 * and only when that book is expanded, so the sidebar still reads no text
 * until somebody asks for one book's chapters.
 */

import { useNavigate, useRouterState } from "@tanstack/solid-router";
import { Option } from "effect";
import ArrowRight from "lucide-solid/icons/arrow-right";
import BookIcon from "lucide-solid/icons/book";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import FolderClock from "lucide-solid/icons/folder-clock";
import Library from "lucide-solid/icons/library";
import SearchIcon from "lucide-solid/icons/search";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { For, Show, createMemo, createSignal } from "solid-js";

import { tocViewOf } from "#core/galley";
import { chaptersAddress, type Address } from "#core/location/address";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Badge, Input, SegmentedControl } from "../primitives";
import { bookName, testamentOf, type Testament } from "./books";
import { metadataOf, projectLanguage, projectName } from "./project";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly testament: Testament;
  readonly attention: number;
}

interface Chapter {
  /** The row in the focused book's chapter table; the 1-based number otherwise. */
  readonly index: number;
  readonly label: string;
  readonly intro: boolean;
}

/** The chapter a typed place names, if it names one: "Luke 3" and "Luke 3:1" do, "Luke" does not. */
const chapterOf = (address: Address | undefined): number | undefined => {
  if (address?.kind === "chapters") return address.from;
  if (address?.kind === "verses") return address.from.chapter;
  return undefined;
};

export function ProjectSidebar() {
  const navigate = useNavigate();
  const shell = useShell();
  const [query, setQuery] = createSignal("", { name: "sidebarQuery" });
  /**
   * The testament somebody picked, and the book that was focused when they
   * did. Derived, not synced by an effect: a choice holds until the editor
   * opens another book, and then the testament follows it — landing in
   * Psalms shows the OT.
   */
  const [picked, setPicked] = createSignal<
    { readonly testament: Testament; readonly during: string | undefined } | undefined
  >(undefined, { name: "sidebarTestament" });
  const testament = (): Testament => {
    const focused = shell.focused()?.id;
    const choice = picked();
    if (choice !== undefined && choice.during === focused) return choice.testament;
    return testamentOf(focused ?? "MAT");
  };
  const pickTestament = (next: Testament): void => {
    setPicked({ testament: next, during: shell.focused()?.id });
  };
  /** The one open book; `undefined` means "follow the focused book". */
  const [opened, setOpened] = createSignal<string | null | undefined>(undefined, {
    name: "sidebarOpened",
  });

  // A memo: it tracks the findings store, not `tick`, so typing in a book does
  // not rebuild sixty-six rows to redraw badges that have not moved.
  const rows = createMemo(
    (): readonly Row[] => {
      const project = shell.project();
      if (project === undefined) return [];
      const metadata = metadataOf(project);
      return project.books.map((book) => ({
        id: book.id,
        name: bookName(book.id, metadata),
        testament: testamentOf(book.id),
        attention: shell.attentionOf(book.id),
      }));
    },
    { name: "sidebarBooks" },
  );

  /**
   * What the filter box means, read by the project's Location — the same
   * names, localized and alternate, that the palette and every "go to" use.
   * `books` is every book the words could mean; `chapter` is set once a
   * number follows them.
   */
  const search = createMemo(
    () => {
      const text = query().trim();
      if (text === "") return undefined;
      const citation = shell.location.read(text);
      const chapter = chapterOf(citation.ok ? citation.addresses[0] : undefined);
      return {
        books: new Set(shell.location.books(text)),
        chapter: chapter === undefined ? "" : String(chapter),
      };
    },
    { name: "sidebarSearch" },
  );
  const searching = (): boolean => search() !== undefined;

  /**
   * The books on show. While searching, both testaments: somebody typing
   * "Genesis" with New Testament selected wants Genesis, not an empty list.
   */
  const shown = createMemo(
    (): readonly Row[] => {
      const found = search();
      if (found === undefined) return rows().filter((row) => row.testament === testament());
      return rows().filter((row) => found.books.has(row.id));
    },
    { name: "sidebarShown" },
  );

  const isOpen = (id: string): boolean => {
    if ((search()?.chapter ?? "") !== "") return true;
    const choice = opened();
    return choice === undefined ? shell.focused()?.id === id : choice === id;
  };

  const chaptersOf = (id: string): readonly Chapter[] => {
    if (shell.focused()?.id === id) {
      const rows: Chapter[] = [];
      shell.outline().forEach((chapter, index) => {
        if (chapter.label !== "") rows.push({ index, label: chapter.label, intro: false });
        // The front matter row, and only if it holds something.
        else if (index === 0 && chapter.to > chapter.from)
          rows.push({ index, label: t("Intro"), intro: true });
      });
      return rows;
    }
    // Any other book: the engine's TOC from the analysis the project holds
    // for it — never a scan of the text. Front matter is the focused book's
    // concern; row 0 here is skipped.
    const held = Option.getOrUndefined(shell.services.projectAnalysis.analysis(id));
    if (held === undefined) return [];
    return tocViewOf(held.analysis)
      .chapters.filter((chapter) => chapter.number > 0)
      .map((chapter) => ({ index: chapter.number, label: String(chapter.number), intro: false }));
  };

  const openChapter = (id: string, chapter: Chapter): void => {
    // The focused book goes through `showChapter`, which decides clip vs
    // scroll and knows the intro row; any other book is a reference.
    if (shell.focused()?.id === id) shell.showChapter(chapter.index);
    else shell.showReference(chaptersAddress(id, chapter.index));
  };

  const BookRow = (rowProps: { readonly row: Row }) => {
    const focused = (): boolean => shell.focused()?.id === rowProps.row.id;
    const open = (): boolean => isOpen(rowProps.row.id);
    const chapters = createMemo(
      (): readonly Chapter[] => {
        if (!open()) return [];
        const all = chaptersOf(rowProps.row.id);
        const wanted = search()?.chapter ?? "";
        return wanted === "" ? all : all.filter((chapter) => chapter.label.startsWith(wanted));
      },
      { name: "sidebarChapters" },
    );
    return (
      <li>
        <button
          type="button"
          data-testid={`sidebar-book-${rowProps.row.id}`}
          data-book={rowProps.row.id}
          data-focused={focused() ? "" : undefined}
          aria-expanded={open() ? "true" : "false"}
          class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-small transition-colors data-focused:bg-sidebar-surface-active data-focused:font-medium data-focused:text-brand not-data-focused:text-sidebar-on-surface not-data-focused:hover:bg-sidebar-surface-hover"
          onClick={() => setOpened(open() ? null : rowProps.row.id)}
        >
          <BookIcon size={15} aria-hidden="true" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">{rowProps.row.name}</span>
          <Show when={rowProps.row.attention > 0}>
            <span
              title={t("This book has findings to review.")}
              class="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-warning px-1.5 py-0.5 text-smallest font-medium text-on-surface-warning"
            >
              <TriangleAlert size={11} aria-hidden="true" />
              {t("Review")}
            </span>
          </Show>
          <span aria-hidden="true" class="shrink-0">
            <Show when={open()} fallback={<ChevronRight size={14} />}>
              <ChevronDown size={14} />
            </Show>
          </span>
        </button>

        <Show when={open() && chapters().length > 0}>
          <ol class="mt-1 mb-2 grid grid-cols-4 gap-1 ps-7 pe-2">
            <For each={chapters()}>
              {(chapter) => (
                <li>
                  <button
                    type="button"
                    data-chapter={chapter.index}
                    data-testid={`chapter-tile-${chapter.intro ? "intro" : chapter.label}`}
                    data-current={focused() && shell.chapter() === chapter.index ? "" : undefined}
                    class="w-full cursor-pointer rounded-md border py-1 text-center text-smallest tabular-nums transition-colors data-current:border-brand data-current:bg-brand-light data-current:font-semibold data-current:text-brand not-data-current:border-surface-border not-data-current:bg-surface-primary not-data-current:text-on-surface-secondary not-data-current:hover:bg-sidebar-surface-hover"
                    onClick={() => openChapter(rowProps.row.id, chapter)}
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
    <nav aria-label={t("Recent projects")} class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
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
                onClick={() =>
                  void navigate({
                    to: "/project/$slug",
                    params: { slug: shell.slugFor(recent.root) },
                    search: {},
                  })
                }
              >
                <FolderClock size={15} aria-hidden="true" class="shrink-0" />
                <span class="min-w-0 flex-1 truncate">{recent.name}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </nav>
  );

  const path = useRouterState({ select: (state) => state.location.pathname });
  const choosing = (): boolean => path() === "/" || path().startsWith("/start");

  return (
    <div
      class="flex h-full flex-col border-e border-sidebar-border bg-sidebar-surface"
      data-testid="sidebar"
    >
      <div class="px-4 pt-4 pb-2">
        {/* With no project open the button is an invitation rather than a
            label: two lines of brand text and an arrow. Same destination. */}
        <Show
          when={shell.project()}
          fallback={
            <button
              type="button"
              data-testid="sidebar-project"
              class="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-brand bg-brand-light p-4 text-start text-brand transition-colors hover:bg-sidebar-surface-hover"
              onClick={() => void navigate({ to: "/projects" })}
            >
              <span class="flex min-w-0 flex-1 flex-col gap-1 leading-normal">
                <span class="block truncate text-h4 leading-normal font-bold">
                  {t("Find a Project")}
                </span>
                <span class="block truncate text-body leading-normal">
                  {t("Projects available on WACS")}
                </span>
              </span>
              <ArrowRight size={20} aria-hidden="true" class="shrink-0" />
            </button>
          }
        >
          <button
            type="button"
            data-testid="sidebar-project"
            data-current={choosing() ? "" : undefined}
            class="flex w-full cursor-pointer items-center gap-2 rounded-2xl border bg-surface-primary p-4 text-start transition-colors hover:bg-sidebar-surface-hover data-current:border-brand data-current:bg-brand-light not-data-current:border-surface-border"
            onClick={() => void navigate({ to: "/projects" })}
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-small font-bold text-on-surface-primary">
                {projectName(shell.project())}
              </span>
              <Show when={projectLanguage(shell.project()) !== ""}>
                <span class="block truncate text-smallest text-on-surface-tertiary">
                  {projectLanguage(shell.project())}
                </span>
              </Show>
            </span>
            <ChevronDown size={16} aria-hidden="true" class="shrink-0 text-on-surface-tertiary" />
          </button>
        </Show>
      </div>

      <Show
        when={shell.project()}
        fallback={
          <Show when={shell.firstRun()} fallback={<Recents />}>
            <div
              data-testid="sidebar-empty"
              class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-small text-on-surface-tertiary"
            >
              <Library size={32} strokeWidth={1.5} aria-hidden="true" />
              <p>
                {t(
                  "When your translation project is loaded into Sefer, its books will appear here.",
                )}
              </p>
            </div>
          </Show>
        }
      >
        <div class="flex flex-col gap-2 px-4 pb-2">
          <Input
            size="sm"
            type="search"
            data-testid="sidebar-search"
            icon={<SearchIcon size={14} />}
            aria-label={t("Search for book and chapter")}
            placeholder={t("Search for book and chapter")}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <SegmentedControl
            label={t("Testament")}
            size="sm"
            class="w-full"
            items={[
              { value: "ot", label: t("Old Testament") },
              { value: "nt", label: t("New Testament") },
            ]}
            value={testament()}
            onChange={pickTestament}
          />
        </div>

        <nav aria-label={t("Books")} class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <Show
            when={shown().length > 0}
            fallback={
              <p class="px-2 py-4 text-small text-on-surface-tertiary">
                {rows().length === 0
                  ? t("This project has no books yet.")
                  : searching()
                    ? t("No book matches {query}", { query: query().trim() })
                    : t("No books in this testament.")}
              </p>
            }
          >
            <ul>
              <For each={shown()}>{(row) => <BookRow row={row} />}</For>
            </ul>
          </Show>
        </nav>
      </Show>

      {/* The mockup's "Update available" pill: one `Updater.check()` per
          session, read here rather than asked for. */}
      <Show when={shell.updateAvailable()}>
        <footer class="border-t border-sidebar-border p-4">
          <Badge tone="brand">{t("Update available")}</Badge>
        </footer>
      </Show>
    </div>
  );
}
