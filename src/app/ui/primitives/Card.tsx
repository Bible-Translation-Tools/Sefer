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

export interface CardProps extends ComponentProps<"section"> {
  /** Off when the body is a full-bleed list or table. */
  readonly padded?: boolean;
}

export function Card(props: CardProps) {
  const rest = omit(props, "padded", "class");
  const merged = merge(rest, {
    get class() {
      return cx(
        "rounded-lg border border-surface-border bg-surface-primary shadow-small",
        props.padded === false ? undefined : "p-4",
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
  readonly class?: ClassValue;
}

export function PanelHeader(props: PanelHeaderProps) {
  return (
    <div class={cx("flex flex-wrap items-center gap-3", props.class)}>
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
      {props.actions !== undefined && (
        <div class="ms-auto flex flex-wrap items-center gap-2">{props.actions}</div>
      )}
    </div>
  );
}
