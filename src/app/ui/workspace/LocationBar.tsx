/**
 * The sticky location bar: where in the book the top of the page is.
 *
 * A thin, semi-transparent strip inside the editor card, above the text and
 * scrolling with nothing — the way an editor keeps a heading pinned while you
 * read past it. It answers one question the toolbar cannot: the toolbar says
 * which book and which CLIP is open, and a clip is a choice; this says which
 * chapter you are actually looking at, which changes as you scroll.
 *
 * It is a BREADCRUMB, not a label. The book is the first crumb and goes to the
 * project's book list; the chapter is the second and opens the book's outline,
 * so "where am I" and "take me somewhere else" are the same two words. The
 * arrows step to the neighbouring chapter.
 *
 * What "go to a chapter" MEANS is not decided here — `shell.showChapter` reads
 * the reader's "open books one chapter at a time" preference and either clips
 * or scrolls (documentation/architecture/shell.md). The bar asks for a chapter
 * and does not care which happened.
 */

import { useNavigate } from "@tanstack/solid-router";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import ListTree from "lucide-solid/icons/list-tree";
import { Show, createMemo, createSignal } from "solid-js";

import { fold } from "../../../core/reference/reference";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { FilterList, IconButton, Popover } from "../primitives";
import { bookName, CANON } from "./books";
import { metadataOf } from "./project";

export interface LocationBarProps {
  /** The chapter row at the top of the viewport, as the editor measured it. */
  readonly ordinal: number | undefined;
}

/** What a chapter row is called when it has no `\c` number: the front matter. */
const INTRO_LABEL = "Intro";

export function LocationBar(props: LocationBarProps) {
  const shell = useShell();
  const navigate = useNavigate();
  const [outline, setOutline] = createSignal(false, { name: "outlineOpen" });
  const [picking, setPicking] = createSignal(false, { name: "bookPickerOpen" });

  /**
   * The focused book's chapter table.
   *
   * The shell derives it once, from that book's stamp, and hands back the
   * ARRAY the editor already holds (`ProjectContext.outline`). This bar used
   * to rebuild it behind `shell.tick()` — on every event in the application,
   * for a popover nobody had opened.
   */
  const table = () => shell.outline();

  /**
   * Which chapter the reader is in.
   *
   * THE CLIP WINS. When the book is clipped to one chapter, that chapter IS
   * where you are, whatever the scroll says — and what the scroll says is
   * wrong: the hidden chapters are still in the document, occupying their
   * offsets with zero height, so `chapterInView` sees every chapter as the same
   * nothing and answers with the first row — "Intro" for every chapter of the
   * book.
   *
   * Which made Next and Previous useless with "Open books one chapter at a
   * time" turned on. `step` looks the current row up by this number, so it
   * always found row 0 and always moved to row 1: the first press went to
   * chapter 1 and every press after it went to chapter 1 again, while the
   * crumb read "Intro" throughout.
   *
   * The scroll reading is the answer only when the whole book is on screen,
   * which is exactly when there is no clip.
   */
  const at = (): number => shell.chapter() ?? props.ordinal ?? 0;

  /**
   * The crumb's own row, by index. A chapter's ordinal IS its index in the
   * engine's table — `shell.showChapter` indexes it the same way — so the one
   * row on screen costs a lookup, not a scan.
   */
  const current = () => {
    const row = table()[at()];
    if (row === undefined) return undefined;
    return { ordinal: row.ordinal, label: row.label, intro: row.label === "" };
  };

  const name = (): string => {
    const book = shell.focused();
    return book === undefined ? "" : bookName(book.id, metadataOf(shell.project()));
  };

  const where = (): string => {
    const row = current();
    if (row === undefined) return "";
    return row.intro ? t(INTRO_LABEL) : t("Chapter {label}", { label: row.label });
  };

  /**
   * The rows the outline lists, built ONLY while it is open.
   *
   * A book with no front matter has no row 0 worth offering; a book with one
   * has an Intro that is a real place (the identification, the table of
   * contents) and is reachable nowhere else. A later row with no label is a
   * malformed `\c` and is not a place at all.
   */
  const listed = () =>
    table()
      .map((chapter) => ({
        ordinal: chapter.ordinal,
        label: chapter.label === "" ? t(INTRO_LABEL) : chapter.label,
        intro: chapter.label === "",
      }))
      .filter((row, index) => !row.intro || index === 0);

  const rows = createMemo(() => (outline() ? listed() : []), { name: "outlineRows" });

  const step = (delta: 1 | -1): void => {
    // Built on the click, not on every render: stepping is the one thing here
    // that needs the whole list and it happens at pointer speed.
    const list = listed();
    const index = list.findIndex((row) => row.ordinal === at());
    const next = list[(index < 0 ? 0 : index) + delta];
    if (next !== undefined) shell.showChapter(next.ordinal);
  };

  const first = (): boolean => at() === 0;

  /** The last row the outline would list: the last one that carries a label. */
  const lastOrdinal = (): number => {
    const list = table();
    for (let index = list.length - 1; index > 0; index -= 1)
      if (list[index]?.label !== "") return index;
    return 0;
  };

  const last = (): boolean => at() === lastOrdinal();

  /**
   * The books this project holds, in canonical order, named as the project
   * names them.
   *
   * This crumb used to navigate to a whole SCREEN — `/project/$slug?books=1`,
   * a page that existed only because the crumb had nowhere else to go, and
   * which needed a search param to stop the project route forwarding it
   * straight back out again. A picker is what the crumb always meant, and the
   * page and the param are gone with it.
   */
  const books = createMemo(() => {
    const project = shell.project();
    if (project === undefined) return [];
    const metadata = metadataOf(project);
    const order = new Map(CANON.map((book, index) => [book.id, index]));
    return [...project.books]
      .map((book) => ({ id: book.id, name: bookName(book.id, metadata) }))
      .sort(
        (a, b) =>
          (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
  });

  const goToBook = (id: string): void => {
    setPicking(false);
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: shell.slug(), book: encodeURIComponent(id) },
    });
  };

  return (
    <div
      data-testid="location-bar"
      /* OPAQUE, and deliberately not blurred. It was
         `bg-surface-primary/80 backdrop-blur-sm`, and `backdrop-filter` over a
         sticky strip makes the compositor re-rasterize the scripture behind it
         on every frame of a scroll AND after every keystroke — measurable, and
         the worst kind of cost because it lands between the last state update
         and the paint, where no JS profile shows it. A solid bar reads the
         text underneath no worse: it covers it. The token carries dark. */
      class="sticky top-0 z-20 flex items-center gap-1 border-b border-surface-border bg-surface-primary px-3 py-1"
    >
      <Popover
        label={t("Books")}
        side="bottom"
        align="start"
        class="flex max-h-[60vh] w-64 flex-col p-2"
        open={picking()}
        onOpenChange={setPicking}
        trigger={
          <button
            type="button"
            data-testid="location-book"
            class="cursor-pointer truncate rounded px-1 py-0.5 text-smallest font-medium text-on-surface-secondary transition-colors hover:bg-surface-secondary hover:text-on-surface-primary"
          >
            {name()}
          </button>
        }
      >
        <FilterList
          label={t("Filter books")}
          placeholder={t("Book or code…")}
          items={books()}
          current={shell.focused()?.id}
          key={(book) => book.id}
          // The CODE as well as the name: a translator types "mrk" as readily
          // as "Mark", and a project may hold a book the canon does not name.
          match={(book, query) => {
            const needle = fold(query);
            return fold(book.name).includes(needle) || book.id.toLowerCase().includes(needle);
          }}
          onPick={(book) => goToBook(book.id)}
        >
          {(book) => (
            <>
              <span class="w-9 shrink-0 font-mono text-smallest text-on-surface-tertiary">
                {book.id}
              </span>
              <span class="truncate">{book.name}</span>
            </>
          )}
        </FilterList>
      </Popover>

      <Show when={where() !== ""}>
        <span aria-hidden="true" class="text-smallest text-on-surface-tertiary">
          ·
        </span>

        <Popover
          label={t("Outline")}
          side="bottom"
          align="start"
          class="flex max-h-[60vh] w-56 flex-col p-2"
          open={outline()}
          onOpenChange={setOutline}
          trigger={
            <button
              type="button"
              data-testid="location-chapter"
              class="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-smallest font-medium text-on-surface-secondary transition-colors hover:bg-surface-secondary hover:text-on-surface-primary"
            >
              {where()}
              <ListTree size={12} aria-hidden="true" />
            </button>
          }
        >
          <FilterList
            label={t("Filter chapters")}
            placeholder={t("Chapter…")}
            items={rows()}
            current={String(at())}
            key={(row) => String(row.ordinal)}
            match={(row, query) => fold(row.label).startsWith(fold(query))}
            onPick={(row) => {
              setOutline(false);
              shell.showChapter(row.ordinal);
            }}
          >
            {(row) => (
              <span data-testid={`outline-${row.intro ? "intro" : row.label}`}>
                {row.intro ? row.label : t("Chapter {label}", { label: row.label })}
              </span>
            )}
          </FilterList>
        </Popover>
      </Show>

      <span class="ms-auto flex items-center gap-0.5">
        <IconButton
          size="sm"
          data-testid="location-previous"
          label={t("Previous chapter")}
          tooltipSide="bottom"
          icon={<ChevronUp size={14} />}
          disabled={first()}
          onClick={() => step(-1)}
        />
        <IconButton
          size="sm"
          data-testid="location-next"
          label={t("Next chapter")}
          tooltipSide="bottom"
          icon={<ChevronDown size={14} />}
          disabled={last()}
          onClick={() => step(1)}
        />
      </span>
    </div>
  );
}
