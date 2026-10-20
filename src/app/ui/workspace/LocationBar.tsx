import { useNavigate } from "@tanstack/solid-router";
import SquareSplitHorizontal from "lucide-solid/icons/square-split-horizontal";
import { createMemo } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { IconButton, Switch } from "../primitives";
import { bookName, CANON } from "./books";
import { Crumbs, LocationStrip } from "./Crumbs";
import { metadataOf } from "./project";
import { typedChapter } from "./typedPlace";

export interface LocationBarProps {
  readonly ordinal: number | undefined;
}

const INTRO_LABEL = "Intro";

export function LocationBar(props: LocationBarProps) {
  const shell = useShell();
  const navigate = useNavigate();

  const table = () => shell.outline();

  const at = (): number => shell.chapter() ?? props.ordinal ?? 0;

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

  const listed = () =>
    table()
      .map((chapter) => ({
        ordinal: chapter.ordinal,
        label: chapter.label === "" ? t(INTRO_LABEL) : chapter.label,
        intro: chapter.label === "",
      }))
      .filter((row, index) => !row.intro || index === 0);

  const step = (delta: 1 | -1): void => {
    const list = listed();
    const index = list.findIndex((row) => row.ordinal === at());
    const next = list[(index < 0 ? 0 : index) + delta];
    if (next !== undefined) shell.showChapter(next.ordinal);
  };

  const first = (): boolean => at() === 0;

  const lastOrdinal = (): number => {
    const list = table();
    for (let index = list.length - 1; index > 0; index -= 1)
      if (list[index]?.label !== "") return index;
    return 0;
  };

  const last = (): boolean => at() === lastOrdinal();

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
      <IconButton
        size="sm"
        label={
          shell.referenceOpen() ? t("Hide the reference texts") : t("Show the reference texts")
        }
        aria-pressed={shell.referenceOpen() ? "true" : "false"}
        data-testid="toggle-references"
        icon={<SquareSplitHorizontal aria-hidden="true" />}
        onClick={() => shell.setReferenceOpen(!shell.referenceOpen())}
      />
      <Crumbs
        book={name()}
        books={books}
        currentBook={shell.focused()?.id}
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
        end={
          <Switch
            class="ms-2"
            label={t("USFM")}
            checked={shell.mode() === "usfm"}
            onChange={(on) => shell.setMode(on ? "usfm" : "default")}
          />
        }
      />
    </LocationStrip>
  );
}
