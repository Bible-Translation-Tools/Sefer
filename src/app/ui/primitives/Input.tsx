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

export type InputSize = "sm" | "md" | "lg";

const field = variants({
  base: [
    "w-full border border-surface-border bg-surface-primary",
    "text-on-surface-primary placeholder:text-on-surface-tertiary",
    "transition-colors hover:border-brand/40 focus:border-brand",
  ].join(" "),
  variants: {
    size: {
      sm: "h-7 rounded-md text-smallest",
      md: "h-9 rounded-md text-small",
      // The page-level search: 56px tall — the height of the large buttons
      // (16px text with 16px padding) — a 16px radius, body text.
      lg: "h-14 rounded-xl text-body",
    },
  },
  defaults: { size: "md" },
});

/**
 * Side padding, and room for the icon: at `lg` the icon sits 32px in and the
 * text starts 16px after a 20px icon, so 32 + 20 + 16 = 68px.
 */
const padding = (size: InputSize, icon: boolean): string => {
  if (size === "lg") return icon ? "ps-[4.25rem] pe-8" : "px-8";
  return icon ? "pe-2.5 ps-8" : "px-2.5";
};

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
        padding(props.size ?? "md", props.icon !== undefined),
        props.class,
      );
    },
  });

  return (
    <span class={cx("relative inline-flex items-center", props.wrapperClass)}>
      {props.icon !== undefined && (
        <span
          aria-hidden="true"
          class={cx(
            "pointer-events-none absolute flex text-on-surface-tertiary",
            props.size === "lg" ? "start-8" : "start-2.5",
          )}
        >
          {props.icon}
        </span>
      )}
      <input {...merged} />
    </span>
  );
}
