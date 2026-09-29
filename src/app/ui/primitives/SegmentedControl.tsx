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
import { For, Show } from "solid-js";

import { cx, type ClassValue } from "./cx";

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
  /**
   * Shown instead of `label` when the control is too narrow for it ("Old" for
   * "Old Testament"); the full label stays the segment's accessible name.
   * Decided by the control's own width (a container query), not the window's.
   */
  readonly shortLabel?: string;
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
   * `md` (the default) and `lg` are 48px tall: a 3px track around 42px
   * segments that share the control's width evenly — 14px medium at `md`,
   * body text at `lg`. Narrow, labels truncate (see `iconsWhenNarrow` for
   * dropping to icons). `sm` is the compact 24px one.
   */
  readonly size?: "sm" | "md" | "lg";
  /**
   * Below `md`, drop to icons, the labels kept for screen readers — the app
   * bar's modes. Only honoured when every segment has an icon.
   */
  readonly iconsWhenNarrow?: boolean;
  readonly class?: ClassValue;
}

/**
 * `collapse` is whether this control may drop to icons below `md` — only
 * when every segment HAS an icon, or a narrow window would show blank tabs.
 */
const sizeClass = (size: SegmentedControlProps<string>["size"], collapse: boolean): string => {
  if (size === "sm") return "h-6 gap-1.5 rounded-md px-2.5 text-smallest";
  // 42px segments inside the 3px track, sharing the control's width evenly;
  // the caller caps the control, so a segment is never wider than its share.
  if (size === "lg")
    return cx(
      "h-10.5 min-w-0 flex-1 justify-center gap-3 rounded-xl px-4 text-body",
      collapse && "max-md:w-10.5 max-md:flex-none max-md:px-0",
    );
  // The default: 42px segments in the 48px track, 12px sides and radius,
  // 14px medium, a 20px icon 6px from its label. `flex-auto`, not `flex-1`:
  // each starts from its own label's width, so a control sized to its content
  // fits its words, and one given a width (the sidebar's) shares the rest.
  return cx(
    "h-10.5 min-w-0 flex-auto justify-center gap-1.5 rounded-lg px-3 text-small [&>svg]:size-5",
    collapse && "max-md:w-10.5 max-md:flex-none max-md:px-0",
  );
};

const toneClass = (chosen: boolean): string => {
  return chosen
    ? "bg-surface-primary text-brand shadow-small"
    : // A step darker than the track on hover, so the target is the segment.
      "text-on-surface-secondary hover:not-disabled:bg-surface-tertiary hover:not-disabled:text-on-surface-primary";
};

export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  const collapses = (): boolean =>
    props.iconsWhenNarrow === true && props.items.every((item) => item.icon !== undefined);
  // By value, never by identity: a caller writing `items` inline hands over
  // new objects on every read of the prop.
  const firstEnabled = (): Segment<T> | undefined =>
    props.items.find((item) => item.disabled !== true);
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
        props.items.some((item) => item.shortLabel !== undefined) && "@container",
        // `md` (the default) and `lg` share the 48px track with 3px inside it.
        props.size === "sm"
          ? "gap-0.5 rounded-lg p-0.5"
          : "h-12 min-w-0 gap-0.75 rounded-2xl p-0.75",
        "border border-surface-border bg-surface-secondary",
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
            aria-label={item.shortLabel === undefined ? undefined : item.label}
            // The first ENABLED segment takes the tab stop when none is chosen,
            // so the group can still be reached from the keyboard — a disabled
            // button cannot take focus, and the rail's first mode is disabled.
            tabindex={
              item.value === props.value ||
              (props.value === undefined && item.value === firstEnabled()?.value)
                ? 0
                : -1
            }
            class={cx(
              "inline-flex items-center font-medium transition-colors",
              "cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
              sizeClass(props.size, collapses()),
              // In a very narrow control the padding gives way to the words.
              item.shortLabel !== undefined && "@max-[8rem]:px-1",
              toneClass(item.value === props.value),
            )}
            onClick={() => props.onChange(item.value)}
          >
            {item.icon}
            <Show
              when={item.shortLabel}
              fallback={
                <span
                  class={
                    props.size === "sm"
                      ? undefined
                      : cx("truncate", collapses() && "max-md:sr-only")
                  }
                >
                  {item.label}
                </span>
              }
            >
              {(short) => (
                <>
                  {/* Full words while the control is at least 18rem wide. */}
                  <span aria-hidden="true" class="truncate @max-2xs:hidden">
                    {item.label}
                  </span>
                  <span aria-hidden="true" class="hidden truncate @max-2xs:inline">
                    {short()}
                  </span>
                </>
              )}
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
