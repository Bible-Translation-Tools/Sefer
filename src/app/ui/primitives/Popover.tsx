/**
 * The popover, over `@corvu-next/popover`.
 *
 * One of the four files allowed to import corvu. The trigger is whatever the
 * caller passes — rendered through `as="span"` so the caller's own button keeps
 * its look, its ref and its handlers.
 *
 * The wrapper is `inline-flex` and NOT `display: contents`, for the same reason
 * `Tooltip` learned: a contents-display box is not a box, so Floating UI
 * measures the trigger's rect as zero and pins the panel to the top-left corner
 * of the viewport instead of under the button.
 *
 * Controlled and uncontrolled both work: pass `open`/`onOpenChange` for the
 * first, pass neither for the second.
 */

import CorvuPopover from "@corvu-next/popover";
import type { JSX } from "@solidjs/web";

import { cx, type ClassValue } from "./cx";

export type PopoverSide = "top" | "bottom" | "left" | "right";
export type PopoverAlign = "start" | "center" | "end";

/** Floating UI spells the centred placement as the bare side. */
const placementOf = (
  side: PopoverSide,
  align: PopoverAlign,
): PopoverSide | `${PopoverSide}-${"start" | "end"}` =>
  align === "center" ? side : `${side}-${align}`;

export interface PopoverProps {
  readonly trigger: JSX.Element;
  readonly children: JSX.Element;
  /** Names the panel for a screen reader. */
  readonly label: string;
  readonly side?: PopoverSide;
  readonly align?: PopoverAlign;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** Classes for the panel — a width, usually. */
  readonly class?: ClassValue;
  /** Classes for the trigger's wrapper, when it must fill its box (a table header). */
  readonly triggerClass?: ClassValue;
  /**
   * Cap the panel at the room left in the viewport and scroll inside it,
   * for a panel that can be taller than the space below its trigger.
   */
  readonly fitViewport?: boolean;
}

export function Popover(props: PopoverProps) {
  return (
    <CorvuPopover
      open={props.open}
      onOpenChange={props.onOpenChange}
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
            "z-40 rounded-lg border border-surface-border bg-surface-primary p-3 text-small",
            "text-on-surface-primary shadow-large",
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
