/**
 * The text field, with an optional leading icon.
 *
 * The icon is positioned rather than laid out beside the input, because the
 * input has to fill the wrapper for a click anywhere in the field to focus it.
 * That is the whole reason this is a component and not a class string.
 *
 * It takes every native input prop, so `type="search"`, `placeholder`,
 * `value`/`onInput` and `aria-label` are the caller's as usual.
 */

import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

import { cx, variants, type ClassValue } from "./cx";

export type InputSize = "sm" | "md";

const field = variants({
  base: [
    "w-full rounded-md border border-surface-border bg-surface-primary",
    "text-on-surface-primary placeholder:text-on-surface-tertiary",
    "transition-colors hover:border-brand/40 focus:border-brand",
  ].join(" "),
  variants: {
    size: {
      sm: "h-7 text-smallest",
      md: "h-9 text-small",
    },
  },
  defaults: { size: "md" },
});

export interface InputProps extends Omit<ComponentProps<"input">, "size"> {
  readonly size?: InputSize;
  /** Sits inside the field, at the start. Decorative: give the input a name. */
  readonly icon?: JSX.Element;
  /** Classes for the wrapper, which is what carries the field's width. */
  readonly wrapperClass?: ClassValue;
}

export function Input(props: InputProps) {
  const rest = omit(props, "size", "icon", "class", "wrapperClass");
  const merged = merge(rest, {
    get class() {
      return cx(
        field({ size: props.size }),
        props.icon === undefined ? "px-2.5" : "pe-2.5 ps-8",
        props.class,
      );
    },
  });

  return (
    <span class={cx("relative inline-flex items-center", props.wrapperClass)}>
      {props.icon !== undefined && (
        <span
          aria-hidden="true"
          class="pointer-events-none absolute start-2.5 flex text-on-surface-tertiary"
        >
          {props.icon}
        </span>
      )}
      <input {...merged} />
    </span>
  );
}
