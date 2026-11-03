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
  /**
   * Stay open when a click or focus lands on a password manager's own overlay
   * (an injected iframe or custom element) — filling a sign-in form otherwise
   * closes the popover under it.
   */
  readonly keepOpenForPasswordManagers?: boolean;
}

/**
 * Whether an element belongs to something a browser extension put in the
 * page rather than to Sefer: an iframe, or inside a custom element (a tag with
 * a dash, which Sefer's own markup does not use).
 */
const injected = (target: EventTarget | null): boolean => {
  for (
    let node = target instanceof Element ? target : null;
    node !== null;
    node = node.parentElement
  )
    if (node.tagName === "IFRAME" || node.tagName.includes("-")) return true;
  return false;
};

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
      onOutsidePointer={(event) => {
        if (props.keepOpenForPasswordManagers === true && injected(event.target))
          event.preventDefault();
      }}
      onOutsideFocus={(event) => {
        // corvu's event is its own, dispatched on the content: what took focus is the active element.
        if (props.keepOpenForPasswordManagers === true && injected(document.activeElement))
          event.preventDefault();
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
        {/* Above a Dialog (z-50): a menu opened inside one must not open behind it. */}
        <CorvuPopover.Content
          aria-label={props.label}
          class={cx(
            "z-60 border border-surface-border bg-surface-primary text-small",
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
