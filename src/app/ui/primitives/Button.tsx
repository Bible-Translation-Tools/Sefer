/**
 * The button. Four variants, two sizes, an optional leading icon, a loading
 * state that also disables.
 *
 * `primary` is the brand fill, `secondary` the outlined default, `tertiary` the
 * quiet one that only paints on hover, `danger` the destructive fill. Every
 * colour is a semantic token, so dark needs nothing here.
 *
 * `aria-pressed` is styled rather than made into a variant: a toggle is a
 * button that reports its own state, and a chip row is easier to read when the
 * state lives in the attribute a screen reader already uses.
 */

import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

import { variants } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger";
export type ButtonSize = "sm" | "md";

const classes = variants({
  base: [
    "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium",
    "whitespace-nowrap transition-colors cursor-pointer select-none",
    "disabled:cursor-not-allowed disabled:opacity-60",
    // A pressed button is a toggle, whatever its variant.
    "aria-pressed:bg-brand-light aria-pressed:border-brand aria-pressed:text-brand",
  ].join(" "),
  variants: {
    variant: {
      primary:
        "bg-button-primary-surface text-button-primary-on-surface border-button-primary-surface hover:not-disabled:bg-button-primary-surface-hover",
      secondary:
        "bg-surface-primary text-button-secondary-on-surface border-button-secondary-border hover:not-disabled:bg-button-secondary-surface-hover",
      tertiary:
        "bg-transparent text-button-tertiary-on-surface border-transparent hover:not-disabled:bg-button-tertiary-surface-hover",
      danger:
        "bg-surface-error text-on-surface-error border-surface-error hover:not-disabled:brightness-95",
    },
    size: {
      sm: "h-7 px-2.5 text-smallest",
      md: "h-9 px-3.5 text-small",
    },
  },
  defaults: { variant: "secondary", size: "md" },
});

export interface ButtonProps extends ComponentProps<"button"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Rendered before the label. An icon element, already sized by the caller. */
  readonly icon?: JSX.Element;
  /** Swaps the icon for a spinner and disables the button. */
  readonly loading?: boolean;
}

export function Button(props: ButtonProps) {
  const rest = omit(props, "variant", "size", "icon", "loading", "class", "type", "disabled");
  const merged = merge(rest, {
    get type() {
      return props.type ?? "button";
    },
    get disabled() {
      return props.disabled === true || props.loading === true;
    },
    get class() {
      return classes({ variant: props.variant, size: props.size }, props.class);
    },
  });

  return (
    <button {...merged}>
      {props.loading === true ? (
        <span
          aria-hidden="true"
          class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        props.icon
      )}
      {props.children}
    </button>
  );
}
