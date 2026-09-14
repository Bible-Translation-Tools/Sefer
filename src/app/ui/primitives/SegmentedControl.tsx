/**
 * The mode switcher: one row of segments, exactly one chosen.
 *
 * A radio group under the skin, not a row of buttons — the reader is picking
 * one of a closed set, and that is what `role="radiogroup"` says. Arrow keys
 * come free from the roving `tabindex` the browser gives radio inputs; here the
 * buttons are explicit, so the row handles the arrows itself.
 *
 * Icons are optional; labels are not, because a segment with no text is an icon
 * button and belongs in `IconButton`.
 */

import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { cx, type ClassValue } from "./cx";

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: JSX.Element;
  readonly disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  readonly items: readonly Segment<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Names the group for a screen reader. */
  readonly label: string;
  readonly size?: "sm" | "md";
  readonly class?: ClassValue;
}

export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  const step = (delta: 1 | -1): void => {
    const items = props.items.filter((item) => item.disabled !== true);
    const at = items.findIndex((item) => item.value === props.value);
    const next = items[(at + delta + items.length) % items.length];
    if (next !== undefined) props.onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      class={cx(
        "inline-flex items-center gap-0.5 rounded-lg border border-surface-border bg-surface-secondary p-0.5",
        props.class,
      )}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") step(1);
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") step(-1);
        else return;
        event.preventDefault();
      }}
    >
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            role="radio"
            aria-checked={item.value === props.value ? "true" : "false"}
            disabled={item.disabled}
            tabindex={item.value === props.value ? 0 : -1}
            class={cx(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 font-medium transition-colors",
              "cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
              props.size === "sm" ? "h-6 text-smallest" : "h-7 text-small",
              item.value === props.value
                ? "bg-surface-primary text-brand shadow-small"
                : "text-on-surface-secondary hover:not-disabled:text-on-surface-primary",
            )}
            onClick={() => props.onChange(item.value)}
          >
            {item.icon}
            {item.label}
          </button>
        )}
      </For>
    </div>
  );
}
