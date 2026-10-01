/**
 * The project sidebar: which project is open, and where in it you are.
 *
 * Top to bottom: the project (name, and language with its code); a search box
 * that filters the list below it, and on Enter takes the book — to the
 * chapter it names, if it names one (`typedPlace`); a testament
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
import Library from "lucide-solid/icons/library";
import SearchIcon from "lucide-solid/icons/search";
import { For, Show, createMemo, createSignal } from "solid-js";

import { tocViewOf } from "#core/galley";
import { chaptersAddress, introAddress } from "#core/location/address";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Badge, IconButton, Input, SegmentedControl } from "../primitives";
import { bookName, testamentOf, type Testament } from "./books";
import { metadataOf, projectLanguage, projectName } from "./project";
import { chapterOf, typedChapter } from "./typedPlace";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly testament: Testament;
}

interface Chapter {
  /** The row in the focused book's chapter table; the 1-based number otherwise. */
  readonly index: number;
  readonly label: string;
  readonly intro: boolean;
}

export function ProjectSidebar() {
  const shell = useShell();
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("", { name: "sidebarQuery" });
  const [searchOpen, setSearchOpen] = createSignal(false, { name: "sidebarSearchOpen" });
  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };
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

  // A memo over the open project, so typing in a book does not rebuild
  // sixty-six rows.
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

  /**
   * Enter takes the book: to the chapter the text names when it names one
   * ("mark 3"), else the first book on show, as the palette's "Go to" does.
   */
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
    closeSearch();
  };

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
    // for it — never a scan of the text. Row 0 is the front matter, offered as
    // "Intro" when it holds something, as it is for the focused book — so the
    // tile is there before the book has been opened, not only after.
    const held = Option.getOrUndefined(shell.services.projectAnalysis.analysis(id));
    if (held === undefined) return [];
    return tocViewOf(held.analysis).chapters.flatMap((chapter): Chapter[] => {
      if (chapter.number > 0)
        return [{ index: chapter.number, label: String(chapter.number), intro: false }];
      return chapter.to > chapter.from ? [{ index: 0, label: t("Intro"), intro: true }] : [];
    });
  };

  const openChapter = (id: string, chapter: Chapter): void => {
    // The focused book goes through `showChapter`, which decides clip vs
    // scroll and knows the intro row; any other book is a reference.
    if (shell.focused()?.id === id) shell.showChapter(chapter.index);
    else if (chapter.intro) shell.showReference(introAddress(id));
    else shell.showReference(chaptersAddress(id, chapter.index));
  };

  /**
   * The chapter the reader is in: the clipped one in chapter view, otherwise
   * the one at the top of the editor, which the editor reports as it scrolls
   * (the same place the location bar's crumb reads).
   */
  const currentChapter = (): number | undefined => {
    const clipped = shell.chapter();
    if (clipped !== null) return clipped;
    const project = shell.project();
    const book = shell.focused();
    if (project === undefined || book === undefined) return undefined;
    const held = shell.lastLocation(project.root);
    return held?.bookId === book.id ? held.at : undefined;
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
    // No block behind an open book: its chapters are bare numbers, and the
    // current one is the white tile with a brand border and text.
    return (
      <li>
        <button
          type="button"
          data-testid={`sidebar-book-${rowProps.row.id}`}
          data-book={rowProps.row.id}
          data-focused={focused() ? "" : undefined}
          aria-expanded={open() ? "true" : "false"}
          class="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg p-3 text-start text-small font-medium transition-colors data-focused:text-brand not-data-focused:text-sidebar-on-surface not-data-focused:hover:bg-sidebar-surface-hover"
          onClick={() => setOpened(open() ? null : rowProps.row.id)}
        >
          <BookIcon size={20} aria-hidden="true" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">{rowProps.row.name}</span>
          <span aria-hidden="true" class="shrink-0">
            <Show when={open()} fallback={<ChevronRight size={14} />}>
              <ChevronDown size={14} />
            </Show>
          </span>
        </button>

        <Show when={open() && chapters().length > 0}>
          <ol
            // Indented to the book's icon (the row's 12px padding). As many
            // columns as 3.75rem tiles — 12px padding round a 14px label as
            // wide as "Intro" — fit, so a wider panel shows more. 1px apart.
            class="grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-px px-3 pt-1 pb-3"
          >
            <For each={chapters()}>
              {(chapter) => (
                <li>
                  <button
                    type="button"
                    data-chapter={chapter.index}
                    data-testid={`chapter-tile-${chapter.intro ? "intro" : chapter.label}`}
                    data-current={focused() && currentChapter() === chapter.index ? "" : undefined}
                    class="h-12 w-full cursor-pointer truncate rounded-lg border px-3 text-center text-small font-medium tabular-nums transition-colors data-current:border-brand data-current:bg-surface-primary data-current:font-semibold data-current:text-brand not-data-current:border-transparent not-data-current:text-on-surface-secondary not-data-current:hover:bg-surface-canvas"
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

  // With no project open the panel says what it is for — its books arrive
  // with a project — and the project control above it is the way to one.

  return (
    <div
      class="flex h-full flex-col border-e border-sidebar-border bg-sidebar-surface"
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
        {/* The search is an icon beside the testament switch; it opens the
            field below, and closes again from Escape or an empty blur. */}
        <div class="flex flex-col gap-2 px-4 pb-2">
          <div class="flex items-center gap-controls">
            <SegmentedControl
              label={t("Testament")}
              class="min-w-0 flex-1"
              items={[
                { value: "ot", label: t("Old Testament"), shortLabel: t("Old") },
                { value: "nt", label: t("New Testament"), shortLabel: t("New") },
              ]}
              value={testament()}
              onChange={pickTestament}
            />
            <IconButton
              label={t("Search for book and chapter")}
              data-testid="sidebar-search-toggle"
              aria-pressed={searchOpen() ? "true" : "false"}
              icon={<SearchIcon />}
              onClick={() => {
                if (searchOpen()) closeSearch();
                else setSearchOpen(true);
              }}
            />
          </div>
          <Show when={searchOpen()}>
            <Input
              ref={(el: HTMLInputElement) => queueMicrotask(() => el.focus())}
              type="search"
              data-testid="sidebar-search"
              icon={<SearchIcon />}
              aria-label={t("Search for book and chapter")}
              // An example, not a description: it fits the narrow panel and
              // shows what the search understands. The label keeps the words.
              placeholder={t("Mark 5")}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeSearch();
                if (event.key === "Enter") takeSearch();
              }}
              onBlur={() => {
                if (query().trim() === "") setSearchOpen(false);
              }}
            />
          </Show>
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

/**
 * The project control at the top of the sidebar: the open project, which goes
 * to the project list, or with none open an invitation to find one. Exported
 * so a screen that claims the sidebar (Key terms) keeps it above its own list.
 */
export function ProjectControl() {
  const navigate = useNavigate();
  const shell = useShell();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const choosing = (): boolean => path() === "/" || path().startsWith("/start");

  return (
    <div class="px-4 pt-4 pb-2">
      {/* With no project open the button is an invitation rather than a
        label: two lines of brand text and an arrow. Same destination. */}
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
  );
}
