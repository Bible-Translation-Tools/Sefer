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
import { createMemo } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { bookName, CANON } from "./books";
import { Crumbs, LocationStrip } from "./Crumbs";
import { metadataOf } from "./project";
import { typedChapter } from "./typedPlace";

export interface LocationBarProps {
  /** The chapter row at the top of the viewport, as the editor measured it. */
  readonly ordinal: number | undefined;
}

/** What a chapter row is called when it has no `\c` number: the front matter. */
const INTRO_LABEL = "Intro";

export function LocationBar(props: LocationBarProps) {
  const shell = useShell();
  const navigate = useNavigate();

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
   * A picker rather than a link to a book-list SCREEN: that screen would exist
   * only because the crumb had nowhere else to go, and would need a search
   * param to stop the project route forwarding it straight back out again. A
   * picker is what the crumb means.
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
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: shell.slug(), book: encodeURIComponent(id) },
    });
  };

  return (
    <LocationStrip testId="location-bar">
      <Crumbs
        book={name()}
        books={books}
        currentBook={shell.focused()?.id}
        // "mark 3" as well: the words the palette reads narrow it to Mark,
        // and taking Mark then goes to chapter 3 (`typedPlace`).
        matchBook={(book, query) => shell.location.books(query).includes(book.id)}
        onBook={(book, query) => {
          const place = typedChapter(shell.location, query, book.id);
          if (place === undefined) goToBook(book.id);
          else shell.showReference(place);
        }}
        chapter={where()}
        chapters={listed}
        currentChapter={at()}
        onChapter={(ordinal) => shell.showChapter(ordinal)}
        step={{
          onPrevious: () => step(-1),
          onNext: () => step(1),
          get first() {
            return first();
          },
          get last() {
            return last();
          },
        }}
      />
    </LocationStrip>
  );
}
