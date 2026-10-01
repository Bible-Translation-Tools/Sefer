/**
 * The many-of-a-few switcher: `SegmentedControl`'s row, but each segment is
 * on or off by itself.
 *
 * For a closed set small enough to show whole — three severities — where a
 * menu would hide what is already on the screen. Each segment is a
 * `<button aria-pressed>`, which is what a screen reader already reads as a
 * toggle; arrows move focus along the row, Space and Enter flip.
 */

import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { cx, type ClassValue } from "./cx";

export interface Toggle<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Rides after the label — a count `Badge`, usually. */
  readonly adornment?: JSX.Element;
}

export interface ToggleGroupProps<T extends string> {
  readonly items: readonly Toggle<T>[];
  readonly pressed: (value: T) => boolean;
  readonly onToggle: (value: T) => void;
  /** Names the group for a screen reader. */
  readonly label: string;
  readonly class?: ClassValue;
}

export function ToggleGroup<T extends string>(props: ToggleGroupProps<T>) {
  const step = (event: KeyboardEvent, delta: 1 | -1): void => {
    const row = event.currentTarget;
    if (!(row instanceof HTMLElement)) return;
    const buttons = [...row.querySelectorAll<HTMLButtonElement>("button")];
    const at = buttons.findIndex((button) => button === document.activeElement);
    buttons[(at + delta + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={props.label}
      class={cx(
        "inline-flex items-center gap-0.5 rounded-lg border border-surface-border bg-surface-secondary p-0.5",
        props.class,
      )}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") step(event, 1);
        else if (event.key === "ArrowLeft") step(event, -1);
        else return;
        event.preventDefault();
      }}
    >
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            aria-pressed={props.pressed(item.value) ? "true" : "false"}
            data-value={item.value}
            class={cx(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-smallest font-medium",
              "cursor-pointer whitespace-nowrap transition-colors",
              "text-on-surface-secondary hover:bg-surface-tertiary hover:text-on-surface-primary",
              "aria-pressed:bg-surface-primary aria-pressed:text-brand aria-pressed:shadow-small",
            )}
            onClick={() => props.onToggle(item.value)}
          >
            {item.label}
            {item.adornment}
          </button>
        )}
      </For>
    </div>
  );
}
