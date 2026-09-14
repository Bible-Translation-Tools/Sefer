/**
 * The popover, over `@corvu-next/popover`.
 *
 * One of the four files allowed to import corvu. The trigger is whatever the
 * caller passes — rendered through `as="span" class="contents"` so the caller's
 * own button keeps its look, its ref and its handlers.
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
}

export function Popover(props: PopoverProps) {
  return (
    <CorvuPopover
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement={placementOf(props.side ?? "bottom", props.align ?? "center")}
      floatingOptions={{ offset: 8, flip: true, shift: true }}
    >
      <CorvuPopover.Trigger as="span" class="contents">
        {props.trigger}
      </CorvuPopover.Trigger>
      <CorvuPopover.Portal>
        <CorvuPopover.Content
          aria-label={props.label}
          class={cx(
            "z-40 rounded-lg border border-surface-border bg-surface-primary p-3 text-small",
            "text-on-surface-primary shadow-large",
            props.class,
          )}
        >
          {props.children}
        </CorvuPopover.Content>
      </CorvuPopover.Portal>
    </CorvuPopover>
  );
}
