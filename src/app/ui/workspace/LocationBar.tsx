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

import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import ListTree from "lucide-solid/icons/list-tree";
import { For, Show, createMemo, createSignal } from "solid-js";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { IconButton, Popover } from "../primitives";
import { bookName } from "./books";
import { metadataOf, projectPath } from "./project";

export interface LocationBarProps {
  /** The chapter row at the top of the viewport, as the editor measured it. */
  readonly ordinal: number | undefined;
  readonly go: (path: string) => void;
}

/** What a chapter row is called when it has no `\c` number: the front matter. */
export const INTRO_LABEL = "Intro";

export function LocationBar(props: LocationBarProps) {
  const shell = useShell();
  const [outline, setOutline] = createSignal(false, { name: "outlineOpen" });

  /**
   * Every chapter row of the focused book, front matter included.
   *
   * Read behind `shell.tick()` like every other derived product: the row list
   * changes when the reader adds a `\c`, and nothing here subscribes to a Book.
   */
  const rows = createMemo(
    () => {
      shell.tick();
      const book = shell.focused();
      if (book === undefined) return [];
      return (
        book
          .structure()
          .chapters.map((chapter) => ({
            ordinal: chapter.ordinal,
            label: chapter.label === "" ? t(INTRO_LABEL) : chapter.label,
            intro: chapter.label === "",
          }))
          // A book with no front matter has no row 0 worth offering; a book with
          // one has an Intro that is a real place (the identification, the table
          // of contents) and is reachable nowhere else.
          .filter((row, index) => !row.intro || index === 0)
      );
    },
    { name: "outlineRows" },
  );

  const at = (): number => props.ordinal ?? shell.chapter() ?? 0;

  const current = () => rows().find((row) => row.ordinal === at());

  const name = (): string => {
    const book = shell.focused();
    return book === undefined ? "" : bookName(book.id, metadataOf(shell.project()));
  };

  const where = (): string => {
    const row = current();
    if (row === undefined) return "";
    return row.intro ? row.label : t("Chapter {label}", { label: row.label });
  };

  const step = (delta: 1 | -1): void => {
    const list = rows();
    const index = list.findIndex((row) => row.ordinal === at());
    const next = list[(index < 0 ? 0 : index) + delta];
    if (next !== undefined) shell.showChapter(next.ordinal);
  };

  const first = (): boolean => rows()[0]?.ordinal === at();
  const last = (): boolean => rows()[rows().length - 1]?.ordinal === at();

  const toBooks = (): void => {
    const project = shell.project();
    if (project !== undefined) props.go(projectPath(project.root));
  };

  return (
    <div
      data-testid="location-bar"
      /* Semi-transparent so the page reads through it while scrolling, and
         backdrop-blurred so the text underneath stays legible. Both tokens,
         so dark needs nothing here. */
      class="sticky top-0 z-20 flex items-center gap-1 border-b border-surface-border bg-surface-primary/80 px-3 py-1 backdrop-blur-sm"
    >
      <button
        type="button"
        data-testid="location-book"
        class="cursor-pointer truncate rounded px-1 py-0.5 text-smallest font-medium text-on-surface-secondary transition-colors hover:bg-surface-secondary hover:text-on-surface-primary"
        onClick={toBooks}
      >
        {name()}
      </button>

      <Show when={where() !== ""}>
        <span aria-hidden="true" class="text-smallest text-on-surface-tertiary">
          ·
        </span>

        <Popover
          label={t("Outline")}
          side="bottom"
          align="start"
          class="max-h-[60vh] w-56 overflow-y-auto p-1"
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
          <For each={rows()}>
            {(row) => (
              <button
                type="button"
                data-testid={`outline-${row.intro ? "intro" : row.label}`}
                data-current={row.ordinal === at() ? "" : undefined}
                class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start text-small text-on-surface-primary transition-colors hover:bg-surface-secondary data-current:bg-brand-light data-current:font-semibold data-current:text-brand"
                onClick={() => {
                  setOutline(false);
                  shell.showChapter(row.ordinal);
                }}
              >
                {row.intro ? row.label : t("Chapter {label}", { label: row.label })}
              </button>
            )}
          </For>
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
