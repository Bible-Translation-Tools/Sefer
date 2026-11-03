import type { JSX } from "@solidjs/web";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { Show } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { MergeSide } from "#core/galley";

import { Button, Menu, MenuItem, MenuLabel, MenuSeparator } from "../../primitives";
import { bookCount, changeCount } from "./helpers";
import type { Scope } from "./types";

export function DecideAll(props: {
  readonly decidable: boolean;
  readonly count: number;
  readonly scope: Scope;
  readonly bookName: string;
  readonly books: number;
  readonly baselineShort: string;
  readonly currentShort: string;
  readonly onDecide: (side: MergeSide | undefined) => void;
}): JSX.Element {
  return (
    <Show when={props.decidable && props.count > 0}>
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
            return m.review_changes_in_books({ changes, books: bookCount(props.books) });
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
  );
}
