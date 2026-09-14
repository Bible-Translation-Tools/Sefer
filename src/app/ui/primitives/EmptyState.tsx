/**
 * What a screen shows when it has nothing to show.
 *
 * Deliberately a primitive rather than a `<p class="muted">` per route: an
 * empty list and a filtered-to-empty list are different sentences, and having
 * one shape for both makes the difference the words rather than the layout.
 *
 * `action` is for the one thing the reader can do about it — never more than
 * one, because a screen with nothing on it is not the place to offer a choice.
 */

import type { JSX } from "@solidjs/web";

import { cx, type ClassValue } from "./cx";

export interface EmptyStateProps {
  /** A lucide icon, sized by the caller. Decorative. */
  readonly icon?: JSX.Element;
  readonly title: string;
  readonly description?: JSX.Element;
  readonly action?: JSX.Element;
  readonly class?: ClassValue;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div
      class={cx(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed border-surface-border",
        "px-6 py-10 text-center",
        props.class,
      )}
    >
      {props.icon !== undefined && (
        <span aria-hidden="true" class="text-on-surface-tertiary">
          {props.icon}
        </span>
      )}
      <p class="text-small font-medium text-on-surface-primary">{props.title}</p>
      {props.description !== undefined && (
        <p class="max-w-prose text-small text-on-surface-tertiary">{props.description}</p>
      )}
      {props.action !== undefined && <div class="mt-2">{props.action}</div>}
    </div>
  );
}
