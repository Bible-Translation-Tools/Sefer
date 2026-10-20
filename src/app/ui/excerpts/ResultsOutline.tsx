import BookIcon from "lucide-solid/icons/book";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { For, Show, createMemo, createSignal } from "solid-js";

import type { BookExcerpts, Excerpt, OutlineRow } from "#core/excerpts/excerpts";

import { t } from "../../i18n";

export interface ResultsOutlineProps {
  readonly title: string;
  readonly groups: readonly BookExcerpts[];
  readonly outline: readonly OutlineRow[];
  readonly active: string | undefined;
  readonly label: (row: OutlineRow) => string;
  readonly keyOf: (group: BookExcerpts, excerpt: Excerpt) => string;
  readonly onGo: (key: string, section: string) => void;
}

interface ChapterTile {
  readonly label: string;
  readonly count: number;
  readonly first: string;
}

const chapterOf = (excerpt: Excerpt): string | undefined => {
  const address = excerpt.address;
  if (address.kind === "verses") return String(address.from.chapter);
  if (address.kind === "chapters") return String(address.from);
  if (address.kind === "intro") return t("Intro");
  return undefined;
};

const tilesOf = (
  group: BookExcerpts,
  keyOf: ResultsOutlineProps["keyOf"],
): readonly ChapterTile[] => {
  const books = new Set(group.excerpts.map((excerpt) => excerpt.bookId));
  if (books.size !== 1) return [];
  const out: { label: string; count: number; first: string }[] = [];
  for (const excerpt of group.excerpts) {
    const label = chapterOf(excerpt);
    if (label === undefined) continue;
    const last = out[out.length - 1];
    if (last?.label === label) last.count += excerpt.hits.length;
    else out.push({ label, count: excerpt.hits.length, first: keyOf(group, excerpt) });
  }
  return out;
};

export function ResultsOutline(props: ResultsOutlineProps) {
  const [opened, setOpened] = createSignal<ReadonlySet<string> | undefined>(undefined, {
    name: "outlineOpened",
  });
  const isOpen = (key: string): boolean => {
    const held = opened();
    return held === undefined ? key === (props.active ?? props.outline[0]?.bookId) : held.has(key);
  };
  const toggle = (key: string): void => {
    const next = new Set(opened() ?? (props.active === undefined ? [] : [props.active]));
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpened(next);
  };

  const total = createMemo(() => props.outline.reduce((sum, row) => sum + row.count, 0), {
    name: "outlineTotal",
  });

  return (
    <div
      class="flex h-full flex-col border-e border-sidebar-border bg-sidebar-surface"
      data-testid="sidebar"
      data-sidebar="results"
    >
      <div class="px-4 pt-4 pb-2">
        <p class="px-2 text-smallest font-semibold tracking-wide text-on-surface-tertiary uppercase">
          {props.title}
        </p>
        <p class="px-2 text-small text-on-surface-secondary">
          {t("{count} results", { count: total() })}
        </p>
      </div>
      <nav aria-label={props.title} class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <ul>
          <For each={props.outline}>
            {(row) => {
              const group = () => props.groups.find((entry) => entry.bookId === row.bookId);
              const tiles = createMemo(
                () => {
                  const held = group();
                  return held === undefined ? [] : tilesOf(held, props.keyOf);
                },
                { name: "outlineTiles" },
              );
              const current = (): boolean => props.active === row.bookId;
              return (
                <li>
                  <button
                    type="button"
                    data-outline={row.bookId}
                    data-focused={current() ? "" : undefined}
                    aria-current={current() ? "true" : undefined}
                    aria-expanded={
                      tiles().length === 0 ? undefined : isOpen(row.bookId) ? "true" : "false"
                    }
                    class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-small transition-colors data-focused:bg-sidebar-surface-active data-focused:font-medium data-focused:text-brand not-data-focused:text-sidebar-on-surface not-data-focused:hover:bg-sidebar-surface-hover"
                    onClick={() => {
                      props.onGo(row.bookId, row.bookId);
                      if (!isOpen(row.bookId)) toggle(row.bookId);
                    }}
                  >
                    <BookIcon size={15} aria-hidden="true" class="shrink-0" />
                    <span class="min-w-0 flex-1 truncate">{props.label(row)}</span>
                    <span class="shrink-0 text-smallest tabular-nums text-on-surface-tertiary">
                      {row.count}
                    </span>
                    <Show when={tiles().length > 0}>
                      <span
                        aria-hidden="true"
                        class="shrink-0"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle(row.bookId);
                        }}
                      >
                        <Show when={isOpen(row.bookId)} fallback={<ChevronRight size={14} />}>
                          <ChevronDown size={14} />
                        </Show>
                      </span>
                    </Show>
                  </button>
                  <Show when={isOpen(row.bookId) && tiles().length > 0}>
                    <ol class="mt-1 mb-2 grid grid-cols-4 gap-1 ps-7 pe-2">
                      <For each={tiles()}>
                        {(tile) => (
                          <li>
                            <button
                              type="button"
                              data-chapter-hits={tile.label}
                              title={t("{count} in chapter {chapter}", {
                                count: tile.count,
                                chapter: tile.label,
                              })}
                              class="flex w-full cursor-pointer items-baseline justify-center gap-1 rounded-md border border-surface-border bg-surface-primary py-1 text-center text-smallest tabular-nums text-on-surface-secondary transition-colors hover:bg-sidebar-surface-hover"
                              onClick={() => props.onGo(tile.first, row.bookId)}
                            >
                              {tile.label}
                            </button>
                          </li>
                        )}
                      </For>
                    </ol>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </nav>
    </div>
  );
}
