import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { cx, type ClassValue } from "./cx";

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly shortLabel?: string;
  readonly icon?: JSX.Element;
  readonly disabled?: boolean;
  readonly title?: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly items: readonly Segment<T>[];
  readonly value: T | undefined;
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly size?: "sm" | "md" | "lg";
  readonly tone?: "default" | "light";
  readonly iconsWhenNarrow?: boolean;
  readonly class?: ClassValue;
}

const sizeClass = (size: SegmentedControlProps<string>["size"], collapse: boolean): string => {
  if (size === "sm") return "h-6 gap-1.5 rounded-md px-2.5 text-smallest [&>svg]:size-4";
  if (size === "lg")
    return cx(
      "h-10.5 min-w-0 flex-1 justify-center gap-3 rounded-xl px-4 text-body",
      collapse && "max-md:w-10.5 max-md:flex-none max-md:px-0",
    );
  return cx(
    "h-10.5 min-w-0 flex-auto justify-center gap-1.5 rounded-lg px-3 text-small [&>svg]:size-5",
    collapse && "max-md:w-10.5 max-md:flex-none max-md:px-0",
  );
};

const toneClass = (chosen: boolean, tone: SegmentedControlProps<string>["tone"]): string => {
  if (tone === "light")
    return chosen
      ? "bg-brand-light text-brand"
      : "text-on-surface-secondary hover:not-disabled:bg-surface-secondary hover:not-disabled:text-on-surface-primary";
  return chosen
    ? "bg-surface-primary text-brand shadow-small"
    : "text-on-surface-secondary hover:not-disabled:bg-surface-tertiary hover:not-disabled:text-on-surface-primary";
};

export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  const collapses = (): boolean =>
    props.iconsWhenNarrow === true && props.items.every((item) => item.icon !== undefined);
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
        props.size === "sm"
          ? "gap-0.5 rounded-lg p-0.5"
          : "h-12 min-w-0 gap-0.75 rounded-2xl p-0.75",
        props.tone === "light"
          ? "border border-surface-border bg-surface-primary"
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
            aria-label={item.shortLabel === undefined ? undefined : item.label}
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
              item.shortLabel !== undefined && "@max-[8rem]:px-1",
              toneClass(item.value === props.value, props.tone),
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
