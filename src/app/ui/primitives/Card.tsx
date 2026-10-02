/**
 * The white card every page sits on, and the header row that titles one.
 *
 * The ground is `surface-secondary`; a card is `surface-primary` with a 12px
 * radius and the softest of the three shadows. `padded={false}` is for a card
 * whose body is a list or a table that must reach the edges.
 *
 * It takes every `<section>` prop, so `aria-label` and the `data-*` hooks that
 * the dev surface and the verification scripts query for pass straight through.
 *
 * `PanelHeader` is the card's top line — a title, an optional subtitle, and an
 * `actions` slot pushed to the end. It is a separate export rather than a prop
 * because plenty of cards have no header and plenty of headers sit above
 * something that is not a card.
 */

import type { ComponentProps, JSX } from "@solidjs/web";
import { merge, omit } from "solid-js";

import { cx, type ClassValue } from "./cx";
import { usePageDoor, usePageLeading } from "./pageLeading";

export interface CardProps extends ComponentProps<"section"> {
  /** Off when the body is a full-bleed list or table. */
  readonly padded?: boolean;
  /** `md` (default): 12px radius, 16px padding. `lg`: twice `md`'s 12, 24px radius and padding. */
  readonly size?: "md" | "lg";
  /** Off for a card that should sit back from the ones around it (Key terms' condensed cards). */
  readonly raised?: boolean;
}

export function Card(props: CardProps) {
  const rest = omit(props, "padded", "size", "raised", "class");
  const merged = merge(rest, {
    get class() {
      return cx(
        "border border-surface-border bg-surface-primary",
        props.raised === false ? undefined : "shadow-small",
        props.size === "lg" ? "rounded-3xl" : "rounded-lg",
        props.padded === false ? undefined : props.size === "lg" ? "p-6" : "p-4",
        props.class,
      );
    },
  });
  return <section {...merged} />;
}

export interface PanelHeaderProps {
  readonly title: JSX.Element;
  readonly subtitle?: JSX.Element;
  /** Buttons and controls, laid out at the end of the row. */
  readonly actions?: JSX.Element;
  /** `h2` on a page, `h3` inside a card. */
  readonly level?: 2 | 3;
  /**
   * A page header ends with the layout's door out (Back to the editor). Off
   * for a screen that places `BackToEditor` somewhere else itself.
   */
  readonly door?: boolean;
  readonly class?: ClassValue;
}

export function PanelHeader(props: PanelHeaderProps) {
  const leading = usePageLeading();
  const door = usePageDoor();
  return (
    // At least 48px, an md control's height, so a page's title shares one
    // centre line with the panel toggle and the project card beside it.
    <div class={cx("flex min-h-12 flex-wrap items-center gap-3", props.class)}>
      {/* A page's header leads with what the layout gives it (the panel
          toggle); a card's does not. */}
      {props.level === 3 ? undefined : leading()}
      <div class="min-w-0">
        {props.level === 3 ? (
          <h3 class="truncate text-h4 font-semibold text-on-surface-primary">{props.title}</h3>
        ) : (
          <h2 class="truncate text-h3 font-semibold text-on-surface-primary">{props.title}</h2>
        )}
        {props.subtitle !== undefined && (
          <p class="mt-0.5 text-small text-on-surface-tertiary">{props.subtitle}</p>
        )}
      </div>
      {/* A page's header ends with the way back to the book, after its own
          actions; a card's does not. One row, so the door hugs the actions. */}
      {props.level === 3 || props.door === false ? (
        props.actions !== undefined && (
          <div class="ms-auto flex flex-wrap items-center gap-controls">{props.actions}</div>
        )
      ) : (
        <div class="ms-auto flex flex-wrap items-center gap-controls">
          {props.actions}
          {door()}
        </div>
      )}
    </div>
  );
}
