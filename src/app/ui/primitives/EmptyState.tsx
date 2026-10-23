import type { JSX } from "@solidjs/web";

import { cx, type ClassValue } from "./cx";

export interface EmptyStateProps {
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
