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
  /**
   * `panel` (the default) is a padded card for free content. `menu` has no
   * inner padding and a larger radius, because its rows run edge to edge —
   * it is what `Menu` renders into, and the only other shape a popover has.
   */
  readonly variant?: "panel" | "menu";
  /** Classes for the panel — a width, usually. Not padding or radius: those are the variant's. */
  readonly class?: ClassValue;
  /** Classes for the trigger's wrapper, when it must fill its box (a table header). */
  readonly triggerClass?: ClassValue;
  /**
   * Cap the panel at the room left in the viewport and scroll inside it,
   * for a panel that can be taller than the space below its trigger.
   */
  readonly fitViewport?: boolean;
  /**
   * A selector inside the panel for what takes focus on open — `Menu`'s
   * first row. Without it corvu focuses the panel itself.
   */
  readonly initialFocus?: string;
}

/** What in the trigger can hold focus: the caller's own button, not our wrapper. */
const focusableIn = (wrapper: HTMLElement | undefined): HTMLElement | undefined =>
  wrapper?.querySelector<HTMLElement>("button, a[href], input, [tabindex]") ?? undefined;

export function Popover(props: PopoverProps) {
  let trigger: HTMLElement | undefined;
  let content: HTMLElement | undefined;
  return (
    <CorvuPopover
      open={props.open}
      onOpenChange={props.onOpenChange}
      onInitialFocus={(event) => {
        const first =
          props.initialFocus === undefined
            ? undefined
            : content?.querySelector<HTMLElement>(props.initialFocus);
        if (first === undefined || first === null) return;
        event.preventDefault();
        first.focus();
      }}
      // corvu gives focus back to the TRIGGER, which here is the `span`
      // wrapping the caller's button and cannot hold focus — so without this
      // `Esc` left focus nowhere. Hand it to the button inside instead.
      onFinalFocus={(event) => {
        const target = focusableIn(trigger);
        if (target === undefined) return;
        event.preventDefault();
        target.focus();
      }}
      placement={placementOf(props.side ?? "bottom", props.align ?? "center")}
      floatingOptions={{
        offset: 8,
        flip: true,
        shift: true,
        ...(props.fitViewport === true ? { size: { fitViewPort: true, padding: 8 } } : {}),
      }}
    >
      <CorvuPopover.Trigger
        as="span"
        ref={(element: HTMLElement) => (trigger = element)}
        class={cx("inline-flex", props.triggerClass)}
      >
        {props.trigger}
      </CorvuPopover.Trigger>
      <CorvuPopover.Portal>
        <CorvuPopover.Content
          ref={(element: HTMLElement) => (content = element)}
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
