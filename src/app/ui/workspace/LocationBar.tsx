import { useNavigate } from "@tanstack/solid-router";
import SquareSplitHorizontal from "lucide-solid/icons/square-split-horizontal";
import { createMemo } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { IconButton, SegmentedControl, Switch } from "../primitives";
import { bookName, CANON } from "./books";
import { Crumbs, LocationStrip } from "./Crumbs";
import { metadataOf } from "./project";
import { typedChapter } from "./typedPlace";

export interface LocationBarProps {
  readonly ordinal: number | undefined;
}

const INTRO_LABEL = "Intro";

function listedChapters(table: ReturnType<ReturnType<typeof useShell>["outline"]>) {
  return table
    .map((chapter) => ({
      ordinal: chapter.ordinal,
      label: chapter.label === "" ? t(INTRO_LABEL) : chapter.label,
      intro: chapter.label === "",
    }))
    .filter((row, index) => !row.intro || index === 0);
}

function lastChapterOrdinal(list: ReturnType<ReturnType<typeof useShell>["outline"]>): number {
  for (let index = list.length - 1; index > 0; index -= 1)
    if (list[index]?.label !== "") return index;
  return 0;
}

function bookChoices(project: ReturnType<ReturnType<typeof useShell>["project"]>) {
  if (project === undefined) return [];
  const metadata = metadataOf(project);
  const order = new Map(CANON.map((book, index) => [book.id, index]));
  return [...project.books]
    .map((book) => ({ id: book.id, name: bookName(book.id, metadata) }))
    .sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
}

function ReferencesToggle() {
  const shell = useShell();
  return (
    <IconButton
      size="sm"
      label={shell.referenceOpen() ? t("Hide the reference texts") : t("Show the reference texts")}
      aria-pressed={shell.referenceOpen() ? "true" : "false"}
      data-testid="toggle-references"
      icon={<SquareSplitHorizontal aria-hidden="true" />}
      onClick={() => shell.setReferenceOpen(!shell.referenceOpen())}
    />
  );
}

type BookView = "reading" | "lines" | "usfm";

export function LocationBar(props: LocationBarProps) {
  const shell = useShell();
  const navigate = useNavigate();

  const bookView = (): BookView => {
    if (shell.mode() === "usfm") return "usfm";
    return shell.lineByLine() ? "lines" : "reading";
  };
  const chooseBookView = (view: BookView): void => {
    shell.setMode(view === "usfm" ? "usfm" : "default");
    if (view !== "usfm") shell.setLineByLine(view === "lines");
  };

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

  const listed = () => listedChapters(table());

  const step = (delta: 1 | -1): void => {
    const list = listed();
    const index = list.findIndex((row) => row.ordinal === at());
    const next = list[(index < 0 ? 0 : index) + delta];
    if (next !== undefined) shell.showChapter(next.ordinal);
  };

  const first = (): boolean => at() === 0;

  const lastOrdinal = (): number => lastChapterOrdinal(table());

  const last = (): boolean => at() === lastOrdinal();

  const books = createMemo(() => bookChoices(shell.project()));

  const goToBook = (id: string): void => {
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: shell.slug(), book: encodeURIComponent(id) },
    });
  };

  return (
    <LocationStrip testId="location-bar">
      <ReferencesToggle />
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
          __SEFER_DESIGN__ ? (
            <span id="editor-view-switch" class="ms-2">
              <SegmentedControl
                size="sm"
                label={t("Show the book as")}
                items={[
                  { value: "reading", label: t("Reading") },
                  { value: "lines", label: t("Line by line") },
                  { value: "usfm", label: t("USFM") },
                ]}
                value={bookView()}
                onChange={chooseBookView}
              />
            </span>
          ) : (
            <Switch
              class="ms-2"
              label={t("USFM")}
              checked={shell.mode() === "usfm"}
              onChange={(on) => shell.setMode(on ? "usfm" : "default")}
            />
          )
        }
      />
    </LocationStrip>
  );
}
