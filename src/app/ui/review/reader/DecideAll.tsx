import type { JSX } from "@solidjs/web";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { Show } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { MergeSide } from "#core/galley";

import { Button, Menu, MenuItem, MenuLabel, MenuSeparator, cx } from "../../primitives";
import { bookCount, changeCount } from "./helpers";
import type { Scope } from "./types";

/**
 * Deciding every change in scope at once. Side by side, each side's choice
 * sits above its own column ({@link ColumnChoices}), so the toolbar keeps only
 * Clear; one text has no columns, so both choices stay in this menu.
 */
export function DecideAll(props: {
  readonly decidable: boolean;
  readonly split: boolean;
  readonly count: number;
  readonly decided: number;
  readonly scope: Scope;
  readonly bookName: string;
  readonly books: number;
  readonly baselineShort: string;
  readonly currentShort: string;
  readonly onDecide: (side: MergeSide | undefined) => void;
}): JSX.Element {
  return (
    <Show when={props.decidable && props.count > 0}>
      <Show
        when={!props.split}
        fallback={
          <Show when={props.decided > 0}>
            <Button
              size="sm"
              variant="tertiary"
              data-review-clear-all
              onClick={() => props.onDecide(undefined)}
            >
              {m.review_clear_these_decisions()}
            </Button>
          </Show>
        }
      >
        <Menu
          label={m.review_decide_all()}
          side="bottom"
          align="end"
          class="w-72"
          trigger={
            <Button size="sm" variant="tertiary" data-review-decide-all>
              {m.review_decide_all()}
              <ChevronDown aria-hidden="true" />
            </Button>
          }
        >
          <MenuLabel>
            {(() => {
              const changes = changeCount(props.count);
              if (props.scope !== "changes")
                return m.review_changes_in_book({ changes, book: props.bookName });
              return m.common_changes_in_books({ changes, books: bookCount(props.books) });
            })()}
          </MenuLabel>
          <MenuItem data-review-take-all onSelect={() => props.onDecide("baseline")}>
            {m.review_take_source_s_for_all({ source: props.baselineShort })}
          </MenuItem>
          <MenuItem data-review-keep-all onSelect={() => props.onDecide("current")}>
            {m.review_keep_source_s_for_all({ source: props.currentShort })}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => props.onDecide(undefined)}>
            {m.review_clear_these_decisions()}
          </MenuItem>
        </Menu>
      </Show>
    </Show>
  );
}

/** "Use this side for all", for the column it stands above. Pressed when every change in scope already uses this side; pressing it again clears them. */
export function ColumnChoice(props: {
  readonly side: MergeSide;
  readonly all: boolean;
  readonly onDecide: (side: MergeSide | undefined) => void;
}): JSX.Element {
  return (
    <Button
      size="sm"
      variant="tertiary"
      aria-pressed={props.all ? "true" : "false"}
      data-review-column-choice={props.side}
      onClick={() => props.onDecide(props.all ? undefined : props.side)}
    >
      {m.review_use_this_side_for_all()}
    </Button>
  );
}

/**
 * The cards' column heads: each side's label with its choice, laid out on the
 * cards' own two columns so each choice stands over the text it takes.
 */
export function ColumnChoices(props: {
  readonly baselineLabel: string;
  readonly currentLabel: string;
  readonly currentFirst: boolean;
  readonly allOf: (side: MergeSide) => boolean;
  readonly onDecide: (side: MergeSide | undefined) => void;
}): JSX.Element {
  const head = (side: MergeSide, label: string, last: boolean) => (
    <div class={cx("flex min-w-0 items-center gap-2 px-3", last && "order-last")}>
      <span class="truncate">{label}</span>
      <span class="ms-auto shrink-0">
        <ColumnChoice side={side} all={props.allOf(side)} onDecide={props.onDecide} />
      </span>
    </div>
  );
  return (
    <div class="grid grid-cols-2 text-smallest text-on-surface-tertiary" data-review-column-choices>
      {head("baseline", props.baselineLabel, props.currentFirst)}
      {head("current", props.currentLabel, false)}
    </div>
  );
}
