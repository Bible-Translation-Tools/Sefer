import { Option } from "effect";
import BookIcon from "lucide-solid/icons/book";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { For, Show } from "solid-js";

import { tocViewOf } from "#core/galley";

import { t } from "../../i18n";
import type { useShell } from "../../ProjectContext";

/** One chapter tile: its number in the book (0 is the intro) and what it shows. */
export interface ChapterTile {
  readonly index: number;
  readonly label: string;
  readonly intro: boolean;
}

type Shell = ReturnType<typeof useShell>;

/** A book's chapters: the open book's from its outline, any other from the project's analysis. */
export function chaptersOf(shell: Shell, id: string): readonly ChapterTile[] {
  if (shell.focused()?.id === id) {
    const rows: ChapterTile[] = [];
    shell.outline().forEach((chapter, index) => {
      if (chapter.label !== "") rows.push({ index, label: chapter.label, intro: false });
      else if (index === 0 && chapter.to > chapter.from)
        rows.push({ index, label: t("Intro"), intro: true });
    });
    return rows;
  }
  const held = Option.getOrUndefined(shell.services.projectAnalysis.analysis(id));
  if (held === undefined) return [];
  return tocViewOf(held.analysis).chapters.flatMap((chapter): ChapterTile[] => {
    if (chapter.number > 0)
      return [{ index: chapter.number, label: String(chapter.number), intro: false }];
    return chapter.to > chapter.from ? [{ index: 0, label: t("Intro"), intro: true }] : [];
  });
}

/**
 * A book as the sidebar lists it: a row that opens to a grid of its chapter
 * tiles. What a press does is the caller's: the sidebar goes there, the
 * importer picks a range.
 */
export function BookChaptersRow(props: {
  readonly id: string;
  readonly name: string;
  readonly open: boolean;
  /** The book is the one in play (the open book, the import's target). */
  readonly marked: boolean;
  readonly chapters: readonly ChapterTile[];
  /** A tile drawn as chosen (the current chapter, a picked range). */
  readonly chosen: (chapter: ChapterTile) => boolean;
  readonly onToggle: () => void;
  readonly onChapter: (chapter: ChapterTile, event: MouseEvent) => void;
  /** Tiles toggle a choice (aria-pressed), rather than go somewhere. */
  readonly toggles?: boolean;
  readonly bookTestId?: string;
  readonly chapterTestId?: (chapter: ChapterTile) => string;
}) {
  return (
    <li>
      <button
        type="button"
        data-testid={props.bookTestId}
        data-book={props.id}
        data-focused={props.marked ? "" : undefined}
        aria-expanded={props.open ? "true" : "false"}
        class="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg p-3 text-start text-small font-medium transition-colors data-focused:text-brand not-data-focused:text-sidebar-on-surface not-data-focused:hover:bg-sidebar-surface-hover"
        onClick={() => props.onToggle()}
      >
        <BookIcon size={20} aria-hidden="true" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate">{props.name}</span>
        <span aria-hidden="true" class="shrink-0">
          <Show when={props.open} fallback={<ChevronRight size={14} />}>
            <ChevronDown size={14} />
          </Show>
        </span>
      </button>

      <Show when={props.open && props.chapters.length > 0}>
        <ol class="grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-px px-3 pt-1 pb-3">
          <For each={props.chapters}>
            {(chapter) => (
              <li>
                <button
                  type="button"
                  data-chapter={chapter.index}
                  data-testid={props.chapterTestId?.(chapter)}
                  data-current={props.chosen(chapter) ? "" : undefined}
                  aria-pressed={
                    props.toggles === true ? (props.chosen(chapter) ? "true" : "false") : undefined
                  }
                  class="h-12 w-full cursor-pointer truncate rounded-lg border px-3 text-center text-small font-medium tabular-nums transition-colors data-current:border-brand data-current:bg-surface-primary data-current:font-semibold data-current:text-brand not-data-current:border-transparent not-data-current:text-on-surface-secondary not-data-current:hover:bg-surface-canvas"
                  onClick={(event) => props.onChapter(chapter, event)}
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
}
