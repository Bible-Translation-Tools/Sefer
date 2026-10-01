/**
 * A native `<select>`, styled.
 *
 * Native on purpose: the platform's picker is keyboard- and screen-reader-
 * correct on every host, scrolls a two-hundred-chapter list without a
 * virtualiser, and is the control a translator's OS already taught them. A
 * listbox built out of divs would be a bigger primitive with less behaviour.
 *
 * The chevron is drawn by us because a native one cannot be recoloured; the
 * element's own appearance is removed and the arrow is an absolutely positioned
 * SVG that ignores pointer events.
 */

import type { ComponentProps } from "@solidjs/web";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { merge, omit } from "solid-js";

import { cx, variants, type ClassValue } from "./cx";

export type SelectSize = "sm" | "md";

const field = variants({
  base: [
    "w-full appearance-none border border-surface-border bg-surface-primary",
    "text-on-surface-primary transition-colors cursor-pointer",
    "hover:border-brand/40 focus:border-brand disabled:cursor-not-allowed",
    // The prominent chapter picker (`data-prominent`) steps forward when the
    // reader has asked to read one chapter at a time.
    "data-[prominent=true]:border-brand data-[prominent=true]:font-semibold",
  ].join(" "),
  variants: {
    size: {
      sm: "h-7 rounded-md ps-2.5 pe-7 text-smallest",
      // The app's control size, as `Button` and `Input`: 48px, 12px sides and
      // radius, 14px text; the end padding clears the 20px chevron.
      md: "h-12 rounded-lg ps-3 pe-10 text-small",
    },
  },
  defaults: { size: "md" },
});

export interface SelectProps extends ComponentProps<"select"> {
  readonly size?: SelectSize;
  /** Classes for the wrapper, which carries the control's width. */
  readonly wrapperClass?: ClassValue;
}

export function Select(props: SelectProps) {
  const rest = omit(props, "size", "class", "wrapperClass");
  const merged = merge(rest, {
    get class() {
      return field({ size: props.size }, props.class);
    },
  });

  return (
    <span class={cx("relative inline-flex items-center", props.wrapperClass)}>
      <select {...merged} />
      <ChevronDown
        aria-hidden="true"
        class={cx(
          "pointer-events-none absolute text-on-surface-tertiary",
          props.size === "sm" ? "end-2 size-3.5" : "end-3 size-5",
        )}
      />
    </span>
  );
}
