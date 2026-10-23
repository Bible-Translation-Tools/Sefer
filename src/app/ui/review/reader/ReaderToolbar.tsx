import type { JSX } from "@solidjs/web";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Columns2 from "lucide-solid/icons/columns-2";
import { For, Show } from "solid-js";

import { t } from "../../../i18n";
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

function ViewMenu(props: { readonly toolbar: ReaderToolbarProps }) {
  return (
    <Menu
      label={t("View")}
      side="bottom"
      align="start"
      class="w-64"
      trigger={
        <Button size="sm" variant="tertiary" data-review-view>
          <Columns2 aria-hidden="true" />

          {viewLabel(props.toolbar.filter)}
          <ChevronDown aria-hidden="true" />
        </Button>
      }
    >
      <MenuLabel>{t("Show")}</MenuLabel>
      <For each={["all", "words", "formatting"] as const}>
        {(value) => (
          <MenuRadio
            checked={props.toolbar.filter === value}
            data-review-filter={value}
            onSelect={() => props.toolbar.onFilter(value)}
          >
            {filterLabel(value)}
          </MenuRadio>
        )}
      </For>
      <MenuSeparator />
      <MenuLabel>{t("Layout")}</MenuLabel>
      <MenuRadio
        checked={props.toolbar.layout === "auto"}
        onSelect={() => props.toolbar.onLayout("auto")}
      >
        {t("Side by side when there is room")}
      </MenuRadio>
      <MenuRadio
        checked={props.toolbar.layout === "split"}
        onSelect={() => props.toolbar.onLayout("split")}
      >
        {t("Side by side")}
      </MenuRadio>
      <MenuRadio
        checked={props.toolbar.layout === "unified"}
        onSelect={() => props.toolbar.onLayout("unified")}
      >
        {t("One text, changes marked")}
      </MenuRadio>
      <MenuSeparator />
      <MenuCheckbox checked={props.toolbar.usfm} onChange={props.toolbar.onUsfm}>
        {t("Show USFM markup")}
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
        label={t("Previous change (Alt-Shift-F5)")}
        icon={<ArrowUp />}
        onClick={() => props.toolbar.onStep(-1)}
      />
      <IconButton
        size="sm"
        label={t("Next change (Alt-F5)")}
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
        label={t("How much to show")}
        value={props.scope}
        onChange={(value) => props.onScope(value)}
        items={[
          {
            value: "changes",
            label: t("Changes"),
            title: t("Each change as a card, with context, across every book"),
          },
          {
            value: "book",
            label: t("Whole book"),
            title: t("The whole book, with its changes drawn in place"),
          },
        ]}
      />
      <ViewMenu toolbar={props} />
      <StepControls toolbar={props} />
    </div>
  );
}
