import { For, Show } from "solid-js";

import type { CompareSource } from "#core/compare";

import { t } from "../../../i18n";
import { Button, Select } from "../../primitives";
import type { SourceChoice } from "../sources";

export function SourcePicker(props: {
  readonly side: "left" | "right";
  readonly value: string;
  readonly other: string;
  readonly picked: CompareSource | undefined;
  readonly choice: SourceChoice | undefined;
  readonly choices: readonly SourceChoice[];
  readonly onPick: (side: "left" | "right", id: string) => void;
}) {
  return (
    <div class="space-y-1">
      <span class="text-smallest font-medium text-on-surface-tertiary">
        {props.side === "left" ? t("To") : t("From")}
      </span>
      <div class="flex items-center gap-2">
        <Select
          size="sm"
          wrapperClass="min-w-0"
          data-review-side={props.side}
          aria-label={props.side === "left" ? t("Compare to") : t("Compare from")}
          value={props.value}
          onChange={(event) => props.onPick(props.side, event.currentTarget.value)}
        >
          <For each={props.choices}>
            {(entry) => (
              <option value={entry.id} disabled={!entry.available || entry.id === props.other}>
                {entry.label}
              </option>
            )}
          </For>
        </Select>
        <Show when={props.choice?.pick !== undefined}>
          <Button size="sm" onClick={() => props.onPick(props.side, props.value)}>
            {props.picked === undefined ? t("Choose…") : t("Change…")}
          </Button>
        </Show>
      </div>
      <p class="text-smallest text-on-surface-tertiary">
        {props.picked?.label ?? props.choice?.explainer ?? ""}
      </p>
    </div>
  );
}
