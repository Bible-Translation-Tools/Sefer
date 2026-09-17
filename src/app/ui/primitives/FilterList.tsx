/**
 * A list you can type at: a filter box above it, arrow keys through it, Enter
 * to take the highlighted row.
 *
 * The books and the chapters of a book are the same widget twice, and the
 * command palette is a third of the same shape. Sixty-six rows is too many to
 * scan and far too many to scroll past with a mouse, so every list of them
 * wants the same three behaviours and they should not be written three times.
 *
 * The filter box takes focus on mount, because a picker you opened is a
 * question you already decided to answer — the alternative is opening a list
 * and then reaching for the mouse to click into its own search box.
 *
 * Filtering is the CALLER's, through `match`. Books match on their id as well
 * as their name ("mrk" and "Mark" both find Mark, and translators type codes);
 * chapters match on their label. Neither rule belongs in a primitive.
 */

import type { JSX } from "@solidjs/web";
import { For, Show, createMemo, createSignal } from "solid-js";

import { t } from "../../i18n";
import { Input } from "./Input";

export interface FilterListProps<T> {
  readonly items: readonly T[];
  /** Does this item answer to what was typed? `query` arrives already trimmed. */
  readonly match: (item: T, query: string) => boolean;
  /** Stable per item, for keying and for the current-row mark. */
  readonly key: (item: T) => string;
  readonly children: (item: T) => JSX.Element;
  readonly onPick: (item: T) => void;
  /** The key of the row to mark as where you already are. */
  readonly current?: string;
  readonly placeholder?: string;
  /** Announced by the filter box; each picker says what it is a list of. */
  readonly label: string;
}

export function FilterList<T>(props: FilterListProps<T>) {
  const [query, setQuery] = createSignal("", { name: "filterListQuery" });
  const [cursor, setCursor] = createSignal(0, { name: "filterListCursor" });

  const shown = createMemo(() => {
    const needle = query().trim();
    return needle === "" ? props.items : props.items.filter((item) => props.match(item, needle));
  });

  // Typing moves the cursor home: the row that was highlighted is usually not
  // even in the new list, and leaving it where it was means Enter takes
  // something the reader is no longer looking at.
  const retype = (value: string): void => {
    setQuery(value);
    setCursor(0);
  };

  const take = (item: T | undefined): void => {
    if (item !== undefined) props.onPick(item);
  };

  const keys = (event: KeyboardEvent): void => {
    const rows = shown();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((at) => Math.min(at + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((at) => Math.max(at - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      take(rows[cursor()]);
    }
  };

  return (
    <div class="flex min-h-0 flex-col gap-2">
      <Input
        size="sm"
        autofocus
        aria-label={props.label}
        placeholder={props.placeholder ?? t("Filter…")}
        value={query()}
        onInput={(event) => retype(event.currentTarget.value)}
        onKeyDown={keys}
      />
      <Show
        when={shown().length > 0}
        fallback={
          <p class="px-2 py-3 text-center text-smallest text-on-surface-tertiary">
            {t("Nothing matches {query}", { query: query() })}
          </p>
        }
      >
        <ul class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <For each={shown()}>
            {(item, index) => (
              <li>
                <button
                  type="button"
                  data-testid={`filter-row-${props.key(item)}`}
                  data-current={props.key(item) === props.current ? "" : undefined}
                  data-cursor={index() === cursor() ? "" : undefined}
                  class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start text-small text-on-surface-primary transition-colors hover:bg-surface-secondary data-cursor:bg-surface-secondary data-current:bg-brand-light data-current:font-semibold data-current:text-brand"
                  // Pointer and keyboard agree on which row is live, so moving
                  // the mouse over a row and pressing Enter takes that row.
                  onMouseEnter={() => setCursor(index())}
                  onClick={() => props.onPick(item)}
                >
                  {props.children(item)}
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
