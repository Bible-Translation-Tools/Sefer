/**
 * The pill: a count, a severity, a state. Text only, never interactive.
 *
 * The tones are the semantic pairs (`--surface-warning` / `--on-surface-warning`)
 * so a badge cannot invent a colour. `neutral` is the default because most
 * badges in this product are counts, and a count is not a judgement.
 */

import type { JSX } from "@solidjs/web";

import { variants, type ClassValue } from "./cx";

export type BadgeTone = "neutral" | "brand" | "warning" | "error" | "success" | "muted";

const classes = variants({
  base: "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap",
  variants: {
    tone: {
      neutral: "bg-surface-secondary text-on-surface-secondary",
      brand: "bg-brand-light text-brand",
      warning: "bg-surface-warning text-on-surface-warning",
      error: "bg-surface-error text-on-surface-error",
      success: "bg-surface-success text-on-surface-success",
      // For a row that is still shown but no longer trusted — a stale finding.
      muted: "bg-surface-tertiary text-on-surface-tertiary",
    },
    size: {
      sm: "px-1.5 py-px text-smallest",
      md: "px-2 py-0.5 text-small",
    },
  },
  defaults: { tone: "neutral", size: "sm" },
});

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly size?: "sm" | "md";
  readonly class?: ClassValue;
  readonly children: JSX.Element;
}

export function Badge(props: BadgeProps) {
  return (
    <span class={classes({ tone: props.tone, size: props.size }, props.class)}>
      {props.children}
    </span>
  );
}

/** The severity a `Finding` carries, as the tone it should wear. */
export const severityTone = (severity: string): BadgeTone => {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "success";
};
