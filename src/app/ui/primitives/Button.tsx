/**
 * The button. Six variants, four sizes, an optional leading icon, a loading
 * state that also disables.
 *
 * `primary` is the brand fill, `secondary` the outlined default, `accent` the
 * outlined one with brand text (the page-level actions of the projects page),
 * `tertiary` the quiet one that only paints on hover, `link` brand text and
 * nothing else, `danger` the destructive fill. Every colour is a semantic
 * token, so dark needs nothing here.
 *
 * Sizes own their radius and padding. `cx` does not merge Tailwind classes,
 * so a caller's `rounded-xl` next to the base's `rounded-md` is decided by
 * stylesheet order, not by who wrote it last — which is what drove callers to
 * `!important`. A look the sizes do not have is a size to add here.
 *
 * `lg` is the 56px button: body text, 16px round, a 16px radius — the height
 * of `Input size="lg"`. `flush` has no box at all, for a `link` that sits in
 * running text or a table cell.
 *
 * `aria-pressed` is styled rather than made into a variant: a toggle is a
 * button that reports its own state, and a chip row is easier to read when the
 * state lives in the attribute a screen reader already uses.
 */

import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

import { variants } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "accent" | "tertiary" | "link" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "flush";

const classes = variants({
  base: [
    "inline-flex items-center justify-center border font-medium",
    "whitespace-nowrap transition-colors cursor-pointer select-none",
    // A disabled button drops its variant's colours entirely rather than
    // fading them: an outlined button at 60% opacity still reads as one you
    // may press, which is the one thing a disabled control must not do.
    "disabled:cursor-not-allowed disabled:border-surface-border",
    "disabled:bg-surface-secondary disabled:text-on-surface-tertiary",
    // `aria-disabled` is the disabled that stays FOCUSABLE — for a control
    // whose tooltip says why it cannot be used. It looks disabled; the caller
    // gives it no handler.
    "aria-disabled:cursor-not-allowed aria-disabled:text-on-surface-tertiary",
    // A pressed button is a toggle, whatever its variant.
    "aria-pressed:bg-brand-light aria-pressed:border-brand aria-pressed:text-brand",
  ].join(" "),
  variants: {
    variant: {
      primary:
        "bg-button-primary-surface text-button-primary-on-surface border-button-primary-surface hover:not-disabled:bg-button-primary-surface-hover",
      secondary:
        "bg-surface-primary text-button-secondary-on-surface border-button-secondary-border hover:not-disabled:bg-button-secondary-surface-hover",
      accent:
        "bg-surface-primary text-brand border-button-secondary-border hover:not-disabled:bg-button-secondary-surface-hover",
      tertiary:
        "bg-transparent text-button-tertiary-on-surface border-transparent hover:not-disabled:bg-button-tertiary-surface-hover",
      link: "bg-transparent text-brand border-transparent hover:not-disabled:not-aria-disabled:underline",
      danger:
        "bg-surface-error text-on-surface-error border-surface-error hover:not-disabled:brightness-95",
    },
    size: {
      sm: "h-7 gap-1.5 rounded-md px-2.5 text-smallest",
      md: "h-9 gap-1.5 rounded-md px-3.5 text-small",
      lg: "h-14 gap-2 rounded-xl px-4 text-body",
      flush: "gap-1.5 text-body",
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
