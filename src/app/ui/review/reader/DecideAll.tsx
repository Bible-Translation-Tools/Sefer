import type { JSX } from "@solidjs/web";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { Show } from "solid-js";

import type { MergeSide } from "#core/galley";

import { t } from "../../../i18n";
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
        label={t("Decide all")}
        side="bottom"
        align="end"
        class="w-72"
        trigger={
          <Button size="sm" variant="tertiary" data-review-decide-all>
            {t("Decide all")}
            <ChevronDown aria-hidden="true" />
          </Button>
        }
      >
        <MenuLabel>
          {(() => {
            const changes = changeCount(props.count);
            if (props.scope !== "changes")
              return t("{changes} in {book}", { changes, book: props.bookName });
            return t("{changes} in {books}", { changes, books: bookCount(props.books) });
          })()}
        </MenuLabel>
        <MenuItem data-review-take-all onSelect={() => props.onDecide("baseline")}>
          {t("Take {source}'s for all", { source: props.baselineShort })}
        </MenuItem>
        <MenuItem data-review-keep-all onSelect={() => props.onDecide("current")}>
          {t("Keep {source}'s for all", { source: props.currentShort })}
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => props.onDecide(undefined)}>{t("Clear these decisions")}</MenuItem>
      </Menu>
    </Show>
  );
}
