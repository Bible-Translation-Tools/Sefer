import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

import { variants } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "accent" | "tertiary" | "link" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "flush";

const classes = variants({
  base: [
    "inline-flex items-center justify-center border font-medium",
    "whitespace-nowrap transition-colors cursor-pointer select-none",
    "disabled:cursor-not-allowed disabled:border-surface-border",
    "disabled:bg-surface-secondary disabled:text-on-surface-tertiary",
    "aria-disabled:cursor-not-allowed aria-disabled:text-on-surface-tertiary",
    "aria-pressed:bg-brand-light aria-pressed:border-brand aria-pressed:text-brand",
  ].join(" "),
  variants: {
    variant: {
      primary: "button-primary",
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
      sm: "h-7 gap-1.5 rounded-md px-2.5 text-smallest [&>svg]:size-4",
      md: "h-12 gap-1.5 rounded-lg px-3 text-small [&>svg]:size-5",
      lg: "h-14 gap-2 rounded-xl px-4 text-body",
      flush: "gap-1.5 text-body",
    },
  },
  defaults: { variant: "secondary", size: "md" },
});

export interface ButtonProps extends ComponentProps<"button"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: JSX.Element;
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
