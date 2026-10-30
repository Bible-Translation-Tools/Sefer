import { chaptersAddress, introAddress } from "@sefer/text/location/address";
import { useNavigate, useRouterState } from "@tanstack/solid-router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Library from "lucide-solid/icons/library";
import Plus from "lucide-solid/icons/plus";
import SearchIcon from "lucide-solid/icons/search";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { Badge, Button, Input } from "../primitives";
import { BookChaptersRow, chaptersOf, type ChapterTile } from "./BookChapters";
import { bookName, testamentOf, type Testament } from "./books";
import { metadataOf, projectLanguage, projectName } from "./project";
import { chapterOf, typedChapter } from "./typedPlace";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly testament: Testament;
}

type Shell = ReturnType<typeof useShell>;

function openChapter(shell: Shell, id: string, chapter: ChapterTile): void {
  if (shell.focused()?.id === id) shell.showChapter(chapter.index);
  else if (chapter.intro) shell.showReference(introAddress(id));
  else shell.showReference(chaptersAddress(id, chapter.index));
}

function currentChapter(shell: Shell): number | undefined {
  const clipped = shell.chapter();
  if (clipped !== null) return clipped;
  const project = shell.project();
  const book = shell.focused();
  if (project === undefined || book === undefined) return undefined;
  const held = shell.lastLocation(project.root);
  return held?.bookId === book.id ? held.at : undefined;
}

function BookRow(props: {
  readonly row: Row;
  readonly open: boolean;
  readonly wanted: string;
  readonly current: number | undefined;
  readonly onToggle: () => void;
}) {
  const shell = useShell();
  const focused = (): boolean => shell.focused()?.id === props.row.id;
  const chapters = createMemo(
    (): readonly ChapterTile[] => {
      if (!props.open) return [];
      // The grid starts at chapter 1: no Intro tile. Open question for the
      // developer — see planning/items/2026-10-19-intro-tile-in-the-chapter-grid.mdx.
      const all = chaptersOf(shell, props.row.id).filter((chapter) => !chapter.intro);
      const wanted = props.wanted;
      return wanted === "" ? all : all.filter((chapter) => chapter.label.startsWith(wanted));
    },
    { name: "sidebarChapters" },
  );
  return (
    <BookChaptersRow
      id={props.row.id}
      name={props.row.name}
      open={props.open}
      marked={focused()}
      chapters={chapters()}
      chosen={(chapter) => focused() && props.current === chapter.index}
      onToggle={props.onToggle}
      onChapter={(chapter) => openChapter(shell, props.row.id, chapter)}
      bookTestId={`sidebar-book-${props.row.id}`}
      chapterTestId={(chapter) => `chapter-tile-${chapter.intro ? "intro" : chapter.label}`}
    />
  );
}

export function ProjectSidebar() {
  const shell = useShell();
  // Both testaments are listed under their headings, and the search is always open.
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("", { name: "sidebarQuery" });
  const [opened, setOpened] = createSignal<string | null | undefined>(undefined, {
    name: "sidebarOpened",
  });

  const rows = createMemo(
    (): readonly Row[] => {
      const project = shell.project();
      if (project === undefined) return [];
      const metadata = metadataOf(project);
      return project.books.map((book) => ({
        id: book.id,
        name: bookName(book.id, metadata),
        testament: testamentOf(book.id),
      }));
    },
    { name: "sidebarBooks" },
  );

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
  const emptyNote = (): string => {
    if (rows().length === 0) return t("This project has no books yet.");
    if (searching()) return t("No book matches {query}", { query: query().trim() });
    return t("No books in this testament.");
  };

  const shown = createMemo(
    (): readonly Row[] => {
      const found = search();
      if (found === undefined) return rows();
      return rows().filter((row) => found.books.has(row.id));
    },
    { name: "sidebarShown" },
  );

  const takeSearch = (): void => {
    const place = typedChapter(shell.location, query());
    const first = shown()[0];
    if (place !== undefined) shell.showReference(place);
    else if (first !== undefined)
      void navigate({
        to: "/project/$slug/book/$book",
        params: { slug: shell.slug(), book: encodeURIComponent(first.id) },
      });
    else return;
    setQuery("");
  };

  const isOpen = (id: string): boolean => {
    if ((search()?.chapter ?? "") !== "") return true;
    const choice = opened();
    return choice === undefined ? shell.focused()?.id === id : choice === id;
  };

  const toggle = (id: string): void => {
    // A book's row only folds its chapter list open or shut; a chapter tile
    // is what navigates.
    setOpened(isOpen(id) ? null : id);
  };

  /**
   * Keeps the open book in sight in the list. When the editor opens a book or
   * the panel comes back, the book's row goes near the TOP, with about two
   * rows above it, so the neighbouring books still show. A chapter move inside
   * the same book only brings its tile into view if it has left it
   * (`nearest`), so reading down a book does not keep jerking the list.
   */
  const [list, setList] = createSignal<HTMLElement>();
  /** Rows above the open book: two 48px rows. */
  const LEAD_IN = 96;
  let placed: string | undefined;
  createEffect(
    () => ({
      nav: list(),
      book: shell.focused()?.id,
      chapter: currentChapter(shell),
      showing: shell.sidebarShowing(),
    }),
    ({ nav, book, showing }) => {
      if (nav === undefined || book === undefined || !showing) {
        placed = undefined;
        return;
      }
      // After the frame that draws the unfolded book's tiles.
      requestAnimationFrame(() => {
        const row = nav.querySelector<HTMLElement>(`[data-book="${book}"]`);
        if (row === null) return;
        if (placed !== book) {
          placed = book;
          const offset = row.getBoundingClientRect().top - nav.getBoundingClientRect().top;
          nav.scrollTop = Math.max(0, nav.scrollTop + offset - LEAD_IN);
          return;
        }
        nav
          .querySelector<HTMLElement>(`[data-book="${book}"] ~ ol [data-current]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    },
  );

  const bookRow = (row: Row) => (
    <BookRow
      row={row}
      open={isOpen(row.id)}
      wanted={search()?.chapter ?? ""}
      current={currentChapter(shell)}
      onToggle={() => toggle(row.id)}
    />
  );

  return (
    <div
      class="flex h-full flex-col border-e border-sidebar-border bg-surface-primary"
      data-testid="sidebar"
    >
      <ProjectControl />

      <Show
        when={shell.project()}
        fallback={
          <div
            data-testid="sidebar-empty"
            class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-small text-on-surface-tertiary"
          >
            <Library size={32} strokeWidth={1.5} aria-hidden="true" />
            <p>
              {t("When your translation project is loaded into Sefer, its books will appear here.")}
            </p>
          </div>
        }
      >
        {/* Always open, pinned above the list: the list scrolls under it. */}
        <div class="flex items-center gap-controls px-4 py-2">
          <Input
            wrapperClass="min-w-0 flex-1"
            type="search"
            data-testid="sidebar-search"
            icon={<SearchIcon />}
            aria-label={m.sidebar_search_label()}
            placeholder={m.sidebar_search_placeholder()}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
              if (event.key === "Enter") takeSearch();
            }}
          />
        </div>

        <nav ref={setList} aria-label={t("Books")} class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <Show
            when={shown().length > 0}
            fallback={<p class="px-2 py-4 text-small text-on-surface-tertiary">{emptyNote()}</p>}
          >
            {/* Both testaments, each under its heading, 24px apart. */}
            <div class="flex flex-col gap-6">
              <For
                each={
                  [
                    { testament: "ot", label: m.sidebar_old_testament() },
                    { testament: "nt", label: m.sidebar_new_testament() },
                  ] as const
                }
              >
                {(section) => (
                  <Show when={shown().some((row) => row.testament === section.testament)}>
                    <section data-testid={`sidebar-testament-${section.testament}`}>
                      <h3 class="flex h-12 items-center px-3 text-small font-semibold text-on-surface-secondary">
                        {section.label}
                      </h3>
                      <ul>
                        <For each={shown().filter((row) => row.testament === section.testament)}>
                          {(row) => bookRow(row)}
                        </For>
                      </ul>
                    </section>
                  </Show>
                )}
              </For>
            </div>
          </Show>

          <Button
            variant="tertiary"
            size="sm"
            class="mt-2 w-full"
            data-testid="add-book"
            icon={<Plus aria-hidden="true" />}
            onClick={() => {
              const root = shell.project()?.root;
              if (root !== undefined) void navigate({ to: "/migrate", search: { into: root } });
            }}
          >
            {t("Add a book…")}
          </Button>
        </nav>
      </Show>

      <Show when={shell.updateAvailable()}>
        <footer class="border-t border-sidebar-border p-4">
          <Badge tone="brand">{t("Update available")}</Badge>
        </footer>
      </Show>
    </div>
  );
}

export function ProjectControl() {
  const navigate = useNavigate();
  const shell = useShell();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const choosing = (): boolean => path() === "/" || path().startsWith("/start");

  return (
    <div class="px-4 pt-4 pb-2">
      <Show
        when={shell.project()}
        fallback={
          <button
            type="button"
            data-testid="sidebar-project"
            class="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-brand bg-brand-light p-4 text-start text-brand transition-colors hover:bg-button-primary-surface hover:text-button-primary-on-surface"
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
          class="flex h-16 w-full cursor-pointer items-center gap-2 rounded-2xl border bg-surface-primary px-4 text-start transition-colors hover:bg-sidebar-surface-hover data-current:border-brand data-current:bg-brand-light not-data-current:border-surface-border"
          onClick={() => void navigate({ to: "/projects" })}
        >
          {/* "Project:" over the project's language and tag. */}
          <span class="min-w-0 flex-1">
            <span class="block truncate text-smallest text-on-surface-secondary">
              {m.sidebar_project_label()}
            </span>
            <span class="block truncate text-small font-semibold text-on-surface-primary">
              {projectLanguage(shell.project()) || projectName(shell.project())}
            </span>
          </span>
          <ChevronDown aria-hidden="true" class="size-5 shrink-0 text-on-surface-primary" />
        </button>
      </Show>
    </div>
  );
}
