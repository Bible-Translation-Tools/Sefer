import CorvuPopover from "@corvu-next/popover";
import type { JSX } from "@solidjs/web";

import { cx, type ClassValue } from "./cx";

export type PopoverSide = "top" | "bottom" | "left" | "right";
export type PopoverAlign = "start" | "center" | "end";

const placementOf = (
  side: PopoverSide,
  align: PopoverAlign,
): PopoverSide | `${PopoverSide}-${"start" | "end"}` =>
  align === "center" ? side : `${side}-${align}`;

export interface PopoverProps {
  readonly trigger: JSX.Element;
  readonly children: JSX.Element;
  readonly label: string;
  readonly side?: PopoverSide;
  readonly align?: PopoverAlign;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly variant?: "panel" | "menu";
  readonly class?: ClassValue;
  readonly triggerClass?: ClassValue;
  readonly fitViewport?: boolean;
  readonly initialFocus?: string;
}

export function Popover(props: PopoverProps) {
  return (
    <CorvuPopover
      open={props.open}
      onOpenChange={props.onOpenChange}
      onInitialFocus={(event) => {
        const panel = event.target instanceof HTMLElement ? event.target : undefined;
        const first =
          props.initialFocus === undefined
            ? undefined
            : panel?.querySelector<HTMLElement>(props.initialFocus);
        if (first === undefined || first === null) return;
        event.preventDefault();
        first.focus();
      }}
      placement={placementOf(props.side ?? "bottom", props.align ?? "center")}
      floatingOptions={{
        offset: 8,
        flip: true,
        shift: true,
        ...(props.fitViewport === true ? { size: { fitViewPort: true, padding: 8 } } : {}),
      }}
    >
      <CorvuPopover.Trigger as="span" class={cx("inline-flex", props.triggerClass)}>
        {props.trigger}
      </CorvuPopover.Trigger>
      <CorvuPopover.Portal>
        <CorvuPopover.Content
          aria-label={props.label}
          class={cx(
            "z-40 border border-surface-border bg-surface-primary text-small",
            "text-on-surface-primary shadow-large",
            props.variant === "menu" ? "rounded-xl py-2" : "rounded-lg p-3",
            props.fitViewport === true && "scrollbar-subtle overflow-y-auto",
            props.class,
          )}
        >
          {props.children}
        </CorvuPopover.Content>
      </CorvuPopover.Portal>
    </CorvuPopover>
  );
}
