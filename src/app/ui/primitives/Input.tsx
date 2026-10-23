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
      md: "h-12 rounded-lg text-small",
      lg: "h-14 rounded-xl text-body",
    },
  },
  defaults: { size: "md" },
});

const padding = (size: InputSize, icon: boolean): string => {
  if (size === "lg") return icon ? "ps-[4.25rem] pe-8" : "px-8";
  if (size === "md") return icon ? "ps-[2.375rem] pe-3" : "px-3";
  return icon ? "pe-2.5 ps-8" : "px-2.5";
};

const iconPosition = (size: InputSize): string => {
  if (size === "lg") return "start-8";
  if (size === "md") return "start-3 [&>svg]:size-5";
  return "start-2.5 [&>svg]:size-4";
};

export interface InputProps extends Omit<ComponentProps<"input">, "size"> {
  readonly size?: InputSize;
  readonly icon?: JSX.Element;
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
            iconPosition(props.size ?? "md"),
          )}
        >
          {props.icon}
        </span>
      )}
      <input {...merged} />
    </span>
  );
}
