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
  /**
   * The native tooltip, which is also the only way a DISABLED segment can say
   * why it is disabled — a segment nobody can press cannot explain itself
   * through a label without growing longer than the row.
   */
  readonly title?: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly items: readonly Segment<T>[];
  /** The chosen segment; `undefined` when none is (a screen outside the set). */
  readonly value: T | undefined;
  readonly onChange: (value: T) => void;
  /** Names the group for a screen reader. */
  readonly label: string;
  /**
   * `lg` is the app bar's mode switcher: 48px tall, a 3px track around 42px
   * segments that share the width, each at most 10rem, with body text. Narrow,
   * the segments shrink and their labels truncate; only below `md` do the
   * labels collapse to screen-reader text and the segments become icons.
   */
  readonly size?: "sm" | "md" | "lg";
  /** `invert` is for a dark bar: a raised track and the chosen segment dark. */
  readonly tone?: "default" | "invert";
  readonly class?: ClassValue;
}

const sizeClass = (size: SegmentedControlProps<string>["size"]): string => {
  if (size === "sm") return "h-6 gap-1.5 rounded-md px-2.5 text-smallest";
  // 42px segments inside the 3px track, sharing the width evenly up to 10rem.
  if (size === "lg")
    return "h-10.5 min-w-0 max-w-40 flex-1 justify-center gap-3 rounded-xl px-4 text-body max-md:w-10.5 max-md:flex-none max-md:px-0";
  return "h-7 gap-1.5 rounded-md px-2.5 text-small";
};

const toneClass = (tone: SegmentedControlProps<string>["tone"], chosen: boolean): string => {
  if (tone === "invert")
    return chosen
      ? "bg-surface-invert font-semibold text-on-surface-invert"
      : "text-on-surface-invert-muted hover:not-disabled:text-on-surface-invert";
  return chosen
    ? "bg-surface-primary text-brand shadow-small"
    : "text-on-surface-secondary hover:not-disabled:text-on-surface-primary";
};

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
        "inline-flex items-center",
        props.size === "lg"
          ? "h-12 min-w-0 gap-0.75 rounded-2xl p-0.75"
          : "gap-0.5 rounded-lg p-0.5",
        props.tone === "invert"
          ? "bg-surface-invert-raised"
          : "border border-surface-border bg-surface-secondary",
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
            title={item.title}
            // The first segment takes the tab stop when none is chosen, so the
            // group can still be reached from the keyboard.
            tabindex={
              item.value === props.value || (props.value === undefined && item === props.items[0])
                ? 0
                : -1
            }
            class={cx(
              "inline-flex items-center font-medium transition-colors",
              "cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
              sizeClass(props.size),
              toneClass(props.tone, item.value === props.value),
            )}
            onClick={() => props.onChange(item.value)}
          >
            {item.icon}
            <span class={props.size === "lg" ? "truncate max-md:sr-only" : undefined}>
              {item.label}
            </span>
          </button>
        )}
      </For>
    </div>
  );
}
