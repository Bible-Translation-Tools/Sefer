import CorvuTooltip from "@corvu-next/tooltip";
import type { JSX } from "@solidjs/web";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  readonly label: string;
  readonly side?: TooltipSide;
  readonly children: JSX.Element;
}

export function Tooltip(props: TooltipProps) {
  return (
    <CorvuTooltip
      placement={props.side ?? "top"}
      openDelay={250}
      closeDelay={80}
      closeOnPointerDown={false}
    >
      <CorvuTooltip.Trigger
        as="span"
        class="inline-flex"
        role={undefined}
        aria-expanded={undefined}
      >
        {props.children}
      </CorvuTooltip.Trigger>
      <CorvuTooltip.Portal>
        <CorvuTooltip.Content class="z-50 rounded-md border border-surface-border bg-surface-primary px-2 py-1 text-smallest text-on-surface-primary shadow-medium">
          {props.label}
        </CorvuTooltip.Content>
      </CorvuTooltip.Portal>
    </CorvuTooltip>
  );
}
