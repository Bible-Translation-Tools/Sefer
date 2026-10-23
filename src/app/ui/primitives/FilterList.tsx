import type { JSX } from "@solidjs/web";
import { For, Show, createMemo, createSignal } from "solid-js";

import { t } from "../../i18n";
import { Input } from "./Input";

export interface FilterListProps<T> {
  readonly items: readonly T[];
  readonly match: (item: T, query: string) => boolean;
  readonly key: (item: T) => string;
  readonly children: (item: T) => JSX.Element;
  readonly onPick: (item: T, query: string) => void;
  readonly current?: string;
  readonly placeholder?: string;
  readonly onQuery?: (query: string) => void;
  readonly searching?: boolean;
  readonly label: string;
}

export function FilterList<T>(props: FilterListProps<T>) {
  const [query, setQuery] = createSignal("", { name: "filterListQuery" });
  const [cursor, setCursor] = createSignal(0, { name: "filterListCursor" });

  const shown = createMemo(() => {
    const needle = query().trim();
    return needle === "" ? props.items : props.items.filter((item) => props.match(item, needle));
  });

  const retype = (value: string): void => {
    setQuery(value);
    setCursor(0);
    props.onQuery?.(value.trim());
  };

  const take = (item: T | undefined): void => {
    if (item !== undefined) props.onPick(item, query().trim());
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
            {props.searching === true
              ? t("Searching…")
              : t("Nothing matches {query}", { query: query() })}
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
                  onMouseEnter={() => setCursor(index())}
                  onClick={() => props.onPick(item, query().trim())}
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
