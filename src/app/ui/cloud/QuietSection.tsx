/**
 * A list's section on a page of lists (Suggestions): a small heading with its
 * count, one quiet line of what the list is, and the rows — on the page's own
 * ground, not in a card. Zed's "Tracked" header is the model: the heading says
 * which list, the count says how many, and nothing draws a box round either.
 */

import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

export function QuietSection(props: {
  readonly title: string;
  readonly count?: number | undefined;
  /** One line of what the list is; tertiary. */
  readonly note?: string;
  readonly children: JSX.Element;
  readonly data?: Readonly<Record<`data-${string}`, string>>;
}) {
  return (
    <section class="space-y-2" {...props.data}>
      <header class="space-y-0.5 border-b border-surface-border pb-2">
        <h3 class="flex items-baseline gap-2 text-small font-semibold text-on-surface-primary">
          {props.title}
          <Show when={props.count !== undefined}>
            <span class="font-normal text-on-surface-tertiary tabular-nums">{props.count}</span>
          </Show>
        </h3>
        <Show when={props.note}>
          {(note) => <p class="text-smallest text-on-surface-tertiary">{note()}</p>}
        </Show>
      </header>
      {props.children}
    </section>
  );
}
