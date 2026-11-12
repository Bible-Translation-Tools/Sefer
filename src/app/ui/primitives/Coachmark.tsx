import CorvuTooltip from "@corvu-next/tooltip";
import type { JSX } from "@solidjs/web";
import { Show, createEffect, createSignal, createUniqueId, onCleanup } from "solid-js";

import type { TooltipSide } from "./Tooltip";

interface CoachmarkProps {
  /** Shown while true; it doesn't open or close on hover, focus or a click elsewhere. */
  readonly show: boolean;
  readonly title: string;
  readonly body: JSX.Element;
  readonly side?: TooltipSide;
  /** Classes for the wrapper around the thing it points at (it is `inline-flex` otherwise). */
  readonly class?: string;
  readonly testId?: string;
  readonly children: JSX.Element;
}

/** How long after the screen appears a pointer waits before showing. */
const SETTLE_MS = 900;

/**
 * A first-run pointer: a dark bubble with an arrow, beside the one control the
 * person should use next. Unlike a Tooltip it stays put until its step is
 * done, and unlike a tour it dims nothing and blocks nothing.
 */
export function Coachmark(props: CoachmarkProps) {
  // A copy of the screen can sit in a hidden panel; only the one on screen
  // points, or a second bubble turns up in the corner. And it waits for the
  // page to settle, so the bubble arrives after the screen rather than with it.
  const [seen, setSeen] = createSignal(false, { name: "coachmarkSeen", ownedWrite: true });
  let element: HTMLElement | undefined;
  let settled = false;
  const look = (): void => {
    setSeen(settled && element !== undefined && element.getClientRects().length > 0);
  };
  const watch = new ResizeObserver(look);
  const track = (next: HTMLElement): void => {
    element = next;
    watch.disconnect();
    watch.observe(next);
  };
  const timer = setTimeout(() => {
    settled = true;
    look();
    watch.observe(document.body);
  }, SETTLE_MS);
  onCleanup(() => {
    watch.disconnect();
    clearTimeout(timer);
  });
  const shown = (): boolean => props.show && seen();
  // The bubble describes the control it points at: a screen reader reads it
  // when that control is focused. The wrapper is not focusable, so the link
  // goes on the control inside it.
  const noteId = createUniqueId();
  createEffect(
    () => shown(),
    (showing) => {
      const control = element?.querySelector<HTMLElement>(
        "button, input, select, textarea, a[href], [tabindex]",
      );
      if (control === null || control === undefined) return;
      if (showing) control.setAttribute("aria-describedby", noteId);
      else if (control.getAttribute("aria-describedby") === noteId)
        control.removeAttribute("aria-describedby");
    },
  );
  return (
    <CorvuTooltip
      open={shown()}
      placement={props.side ?? "right"}
      floatingOptions={{ offset: 12, flip: true, shift: { padding: 8 } }}
      openOnHover={false}
      openOnFocus={false}
      closeOnPointerDown={false}
      closeOnEscapeKeyDown={false}
    >
      <CorvuTooltip.Trigger
        as="div"
        ref={track}
        class={props.class ?? "inline-flex"}
        role={undefined}
        aria-expanded={undefined}
        aria-describedby={undefined}
        data-coach-glow={shown() ? "" : undefined}
      >
        {props.children}
      </CorvuTooltip.Trigger>
      <Show when={shown()}>
        <CorvuTooltip.Portal>
          <CorvuTooltip.Content
            role="note"
            id={noteId}
            data-testid={props.testId}
            class="z-50 max-w-72 animate-[coach-in_220ms_ease-out] rounded-xl bg-on-surface-primary px-3 py-2.5 text-surface-primary shadow-large"
          >
            <p class="text-small font-semibold">{props.title}</p>
            <p class="mt-0.5 text-smallest leading-normal">{props.body}</p>
            <CorvuTooltip.Arrow class="text-on-surface-primary" size={12} />
          </CorvuTooltip.Content>
        </CorvuTooltip.Portal>
      </Show>
    </CorvuTooltip>
  );
}
