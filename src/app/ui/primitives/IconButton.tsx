/**
 * A button whose whole content is an icon.
 *
 * `label` is REQUIRED and is used twice: as the `aria-label`, which is the
 * button's only accessible name, and as the tooltip a sighted reader hovers
 * for. That is the point of having the primitive at all — an icon-only button
 * that forgot its name is not something a caller can build here.
 */

import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

import { variants } from "./cx";
import { Tooltip, type TooltipSide } from "./Tooltip";

export type IconButtonVariant = "subtle" | "filled" | "outlined";
export type IconButtonSize = "sm" | "md" | "lg";

const classes = variants({
  base: [
    "inline-flex items-center justify-center border transition-colors",
    "cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
    "aria-pressed:bg-brand-light aria-pressed:border-brand aria-pressed:text-brand",
  ].join(" "),
  variants: {
    variant: {
      subtle:
        "border-transparent bg-transparent text-on-surface-secondary hover:not-disabled:bg-button-tertiary-surface-hover",
      filled:
        "border-button-primary-surface bg-button-primary-surface text-button-primary-on-surface hover:not-disabled:bg-button-primary-surface-hover",
      outlined:
        "border-surface-border bg-surface-primary text-on-surface-secondary hover:not-disabled:bg-surface-secondary",
    },
    size: {
      // Radius lives with the size, as in `Button`: the 56px one matches
      // `Button size="lg"` beside it.
      sm: "size-7 rounded-md",
      md: "size-9 rounded-md",
      lg: "size-14 rounded-xl",
    },
  },
  defaults: { variant: "subtle", size: "md" },
});

export interface IconButtonProps extends ComponentProps<"button"> {
  /** The accessible name AND the tooltip. Not optional. */
  readonly label: string;
  readonly icon: JSX.Element;
  readonly variant?: IconButtonVariant;
  readonly size?: IconButtonSize;
  readonly tooltipSide?: TooltipSide;
}

export function IconButton(props: IconButtonProps) {
  const rest = omit(props, "label", "icon", "variant", "size", "tooltipSide", "class", "type");
  const merged = merge(rest, {
    get type() {
      return props.type ?? "button";
    },
    get "aria-label"() {
      return props.label;
    },
    get class() {
      return classes({ variant: props.variant, size: props.size }, props.class);
    },
  });

  return (
    <Tooltip label={props.label} side={props.tooltipSide}>
      <button {...merged}>{props.icon}</button>
    </Tooltip>
  );
}
