/**
 * The hover/focus hint, over `@corvu-next/tooltip`.
 *
 * One of the four files allowed to import corvu (see
 * documentation/architecture/ui.md). The library is thin and likely to be
 * swapped; this wrapper is the seam, so a swap is four files rather than every
 * toolbar in the product.
 *
 * A tooltip is a SIGHTED-user affordance. It never carries the accessible name
 * on its own: `<IconButton>` sets `aria-label` from the same string, and any
 * other caller must too.
 */

import CorvuTooltip from "@corvu-next/tooltip";
import type { JSX } from "@solidjs/web";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** The hint. Already localised by the caller. */
  readonly label: string;
  readonly side?: TooltipSide;
  /** The element the hint describes — rendered as the trigger. */
  readonly children: JSX.Element;
}

export function Tooltip(props: TooltipProps) {
  return (
    <CorvuTooltip
      placement={props.side ?? "top"}
      openDelay={250}
      closeDelay={80}
      // The tooltip does NOT close on pointerdown, so an icon button never
      // needs a double-click.
      //
      // corvu's default is to close it on the press. Closing is a state change
      // on the trigger — `aria-describedby` and `data-open` come off it — and
      // Solid rebuilds a `Dynamic`'s subtree when the props it spreads move, so
      // the caller's own `<button>` would be taken out of the DOM and put back
      // BETWEEN pointerdown and pointerup. Chrome does not fire `click` when the
      // pressed node left the document, so the first press would do nothing.
      //
      // Leaving it open through the press is also the better behaviour: the hint
      // stays while the button is held and goes when the pointer leaves.
      closeOnPointerDown={false}
    >
      {/* The trigger is a wrapper around the caller's own element, and it has
          to have a BOX: corvu measures `getBoundingClientRect()` on it to build
          the pointer's safe area, and a `display: contents` wrapper measures
          zero, so the tooltip would never open. `inline-flex` is the smallest
          box that wraps one control without changing a row's layout.

          corvu's `DynamicButton` would also put `role="button"` and
          `aria-expanded` on that wrapper — a second, nameless button around the
          real one — so both are cleared here. They spread after corvu's own,
          which is what lets a caller override them at all. */}
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
