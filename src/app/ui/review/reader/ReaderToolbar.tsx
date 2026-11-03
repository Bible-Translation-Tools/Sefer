import type { JSX } from "@solidjs/web";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Columns2 from "lucide-solid/icons/columns-2";
import { For, Show } from "solid-js";

import { m } from "#app/paraglide/messages";

import {
  Button,
  IconButton,
  Menu,
  MenuCheckbox,
  MenuLabel,
  MenuRadio,
  MenuSeparator,
  SegmentedControl,
} from "../../primitives";
import { filterLabel, viewLabel } from "./helpers";
import type { Filter, Layout, Scope } from "./types";

interface ReaderToolbarProps {
  readonly scope: Scope;
  readonly onScope: (scope: Scope) => void;
  readonly filter: Filter;
  readonly onFilter: (filter: Filter) => void;
  readonly layout: Layout;
  readonly onLayout: (layout: Layout) => void;
  readonly usfm: boolean;
  readonly onUsfm: (on: boolean) => void;
  readonly counter: string | undefined;
  readonly onStep: (delta: 1 | -1) => void;
  readonly decideAll?: JSX.Element;
}

/**
 * How a diff is shown: which changes, side by side or one text, and USFM
 * markup. Review's, and the Word importer's; a section whose setting is not
 * given is left out.
 */
export interface ViewSettings {
  readonly filter?: Filter;
  readonly onFilter?: (filter: Filter) => void;
  readonly layout?: Layout;
  readonly onLayout?: (layout: Layout) => void;
  readonly usfm: boolean;
  readonly onUsfm: (on: boolean) => void;
}

export function ViewMenu(props: { readonly toolbar: ViewSettings }) {
  return (
    <Menu
      label={m.review_view()}
      side="bottom"
      align="start"
      class="w-64"
      trigger={
        <Button size="sm" variant="tertiary" data-review-view>
          <Columns2 aria-hidden="true" />

          {viewLabel(props.toolbar.filter ?? "all")}
          <ChevronDown aria-hidden="true" />
        </Button>
      }
    >
      <Show when={props.toolbar.filter !== undefined}>
        <MenuLabel>{m.review_show()}</MenuLabel>
        <For each={["all", "words", "formatting"] as const}>
          {(value) => (
            <MenuRadio
              checked={props.toolbar.filter === value}
              data-review-filter={value}
              onSelect={() => props.toolbar.onFilter?.(value)}
            >
              {filterLabel(value)}
            </MenuRadio>
          )}
        </For>
        <MenuSeparator />
      </Show>
      <Show when={props.toolbar.layout !== undefined}>
        <MenuLabel>{m.review_layout()}</MenuLabel>
        <MenuRadio
          checked={props.toolbar.layout === "auto"}
          onSelect={() => props.toolbar.onLayout?.("auto")}
        >
          {m.review_side_by_side_when_there()}
        </MenuRadio>
        <MenuRadio
          checked={props.toolbar.layout === "split"}
          onSelect={() => props.toolbar.onLayout?.("split")}
        >
          {m.review_side_by_side()}
        </MenuRadio>
        <MenuRadio
          checked={props.toolbar.layout === "unified"}
          onSelect={() => props.toolbar.onLayout?.("unified")}
        >
          {m.review_one_text_changes_marked()}
        </MenuRadio>
        <MenuSeparator />
      </Show>
      <MenuCheckbox checked={props.toolbar.usfm} onChange={props.toolbar.onUsfm}>
        {m.review_show_usfm_markup()}
      </MenuCheckbox>
    </Menu>
  );
}

function StepControls(props: { readonly toolbar: ReaderToolbarProps }) {
  return (
    <div class="ms-auto flex items-center gap-1">
      {props.toolbar.decideAll}

      <Show when={props.toolbar.counter !== undefined}>
        <span class="text-smallest text-on-surface-tertiary tabular-nums" data-review-counter>
          {props.toolbar.counter}
        </span>
      </Show>
      <IconButton
        size="sm"
        label={m.review_previous_change_alt_shift_f5()}
        icon={<ArrowUp />}
        onClick={() => props.toolbar.onStep(-1)}
      />
      <IconButton
        size="sm"
        label={m.review_next_change_alt_f5()}
        icon={<ArrowDown />}
        onClick={() => props.toolbar.onStep(1)}
      />
    </div>
  );
}

export function ReaderToolbar(props: ReaderToolbarProps): JSX.Element {
  return (
    <div class="flex flex-wrap items-center gap-2" data-review-toolbar>
      <SegmentedControl<Scope>
        size="sm"
        label={m.review_how_much_to_show()}
        value={props.scope}
        onChange={(value) => props.onScope(value)}
        items={[
          {
            value: "changes",
            label: m.common_changes(),
            title: m.review_each_change_as_a_card(),
          },
          {
            value: "book",
            label: m.review_whole_book(),
            title: m.review_the_whole_book_with_its(),
          },
        ]}
      />
      <ViewMenu toolbar={props} />
      <StepControls toolbar={props} />
    </div>
  );
}
