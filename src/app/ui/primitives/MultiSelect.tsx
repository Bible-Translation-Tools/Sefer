/**
 * Pick several from a list: a trigger that says what is chosen, and a panel of
 * rows that toggle without closing it.
 *
 * Give it `match` and it is a combobox — a filter box sits above the rows and
 * takes focus on open, for lists too long to scan (sixty-six books, every
 * finding code). Without it, a plain checklist for a handful of rows.
 *
 * The trigger carries a summary ("2 of 5", "all") because a folded filter that
 * does not say it is filtering is how a reader comes to believe a list is
 * complete; `narrowed` paints it in brand when something is held back.
 *
 * Rows are `role="option"` in an `aria-multiselectable` listbox; arrows move
 * the highlight, Enter and Space toggle it, the same as `FilterList`.
 *
 * `single` makes it a pick-one combobox: choosing a row closes the panel, and
 * the listbox is not multiselectable (Find's source text).
 */

import type { JSX } from "@solidjs/web";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { For, Show, createMemo, createSignal } from "solid-js";

import { t } from "../../i18n";
import { Button } from "./Button";
import { cx } from "./cx";
import { Input } from "./Input";
import { Popover } from "./Popover";

export interface MultiSelectProps<T> {
  readonly items: readonly T[];
  readonly key: (item: T) => string;
  /** The row's content after its check mark. */
  readonly children: (item: T) => JSX.Element;
  readonly selected: (item: T) => boolean;
  readonly onToggle: (item: T) => void;
  /** Names the trigger and the panel. */
  readonly label: string;
  readonly summary: string;
  readonly narrowed: boolean;
  /** Present → searchable. `query` arrives trimmed. */
  readonly match?: (item: T, query: string) => boolean;
  readonly placeholder?: string;
  /** A "show everything again" action under the rows, while narrowed. */
  readonly clear?: { readonly label: string; readonly onClear: () => void };
  /** Lands on the trigger as `data-filter-group`. */
  readonly id?: string;
  /** Pick one: a choice closes the panel. */
  readonly single?: boolean;
  /** In place of the summary chip: a control of the caller's (Refine's "Add source…"). */
  readonly trigger?: JSX.Element;
  /** Said when there are no rows at all, before anything is typed. */
  readonly empty?: string;
  /** Told when the panel opens, so a caller can fetch its rows then. */
  readonly onOpen?: () => void;
}

export function MultiSelect<T>(props: MultiSelectProps<T>) {
  const [open, setOpen] = createSignal(false, { name: "multiSelectOpen" });
  const [query, setQuery] = createSignal("", { name: "multiSelectQuery" });
  const [cursor, setCursor] = createSignal(0, { name: "multiSelectCursor" });

  const shown = createMemo(() => {
    const needle = query().trim();
    const match = props.match;
    return needle === "" || match === undefined
      ? props.items
      : props.items.filter((item) => match(item, needle));
  });

  const close = (): void => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  };
  const pick = (item: T): void => {
    props.onToggle(item);
    if (props.single === true) close();
  };

  const keys = (event: KeyboardEvent): void => {
    const rows = shown();
    if (event.key === "ArrowDown") setCursor((at) => Math.min(at + 1, rows.length - 1));
    else if (event.key === "ArrowUp") setCursor((at) => Math.max(at - 1, 0));
    else if (event.key === "Enter" || (event.key === " " && props.match === undefined)) {
      const row = rows[cursor()];
      if (row !== undefined) pick(row);
    } else return;
    event.preventDefault();
  };

  return (
    <Popover
      label={props.label}
      side="bottom"
      align="start"
      class="flex w-72 flex-col gap-2"
      fitViewport
      initialFocus={props.match === undefined ? "[role=listbox]" : "input"}
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) props.onOpen?.();
        if (!next) {
          setQuery("");
          setCursor(0);
        }
      }}
      trigger={
        props.trigger ?? (
          <button
            type="button"
            class={cx(
              "inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface-primary",
              "px-2.5 py-1.5 text-smallest font-medium text-on-surface-secondary cursor-pointer",
              "hover:bg-surface-secondary hover:text-on-surface-primary transition-colors",
              "data-narrowed:border-brand data-narrowed:bg-brand-light data-narrowed:text-brand",
            )}
            data-filter-group={props.id}
            data-narrowed={props.narrowed ? "" : undefined}
            aria-haspopup="listbox"
            aria-expanded={open() ? "true" : "false"}
          >
            {props.label}
            <span class="text-on-surface-tertiary">{props.summary}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        )
      }
    >
      <Show when={props.match !== undefined}>
        <Input
          size="sm"
          role="combobox"
          aria-expanded="true"
          aria-label={props.label}
          placeholder={props.placeholder ?? t("Filter…")}
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setCursor(0);
          }}
          onKeyDown={keys}
        />
      </Show>
      <Show
        when={shown().length > 0}
        fallback={
          <p class="px-2 py-3 text-center text-smallest text-on-surface-tertiary">
            {query().trim() === "" && props.empty !== undefined
              ? props.empty
              : t("Nothing matches {query}", { query: query() })}
          </p>
        }
      >
        <ul
          role="listbox"
          aria-multiselectable={props.single === true ? undefined : "true"}
          aria-label={props.label}
          tabindex={props.match === undefined ? 0 : -1}
          class="-mx-1 min-h-0 overflow-y-auto px-1 outline-none"
          onKeyDown={keys}
        >
          <For each={shown()}>
            {(item, index) => (
              <li
                role="option"
                aria-selected={props.selected(item) ? "true" : "false"}
                data-key={props.key(item)}
                data-cursor={index() === cursor() ? "" : undefined}
                class={cx(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-small",
                  "text-on-surface-primary transition-colors hover:bg-surface-secondary",
                  "data-cursor:bg-surface-secondary",
                )}
                onMouseEnter={() => setCursor(index())}
                onClick={() => pick(item)}
              >
                <Check
                  size={14}
                  aria-hidden="true"
                  class={props.selected(item) ? "text-brand" : "invisible"}
                />
                {props.children(item)}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.clear !== undefined && props.narrowed}>
        <Button size="sm" variant="tertiary" onClick={() => props.clear?.onClear()}>
          {props.clear?.label}
        </Button>
      </Show>
    </Popover>
  );
}
