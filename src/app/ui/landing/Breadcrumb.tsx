/**
 * The muted trail at the top left of every landing screen
 * ("Sefer / Find Project / Start" in the mockup).
 *
 * It is not navigation state — it is a caption. The router already knows where
 * we are, and a crumb that tried to derive itself from the match would print
 * route ids rather than the words the designer wrote. So the screen says its own
 * trail, and only a crumb given a `to` is a link.
 */

import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";

export interface Crumb {
  readonly label: string;
  /** A typed route path; a crumb without one is plain text. */
  readonly to?: "/" | "/projects" | "/settings" | "/start/find" | "/start/create";
}

export function Breadcrumb(props: { readonly crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" class="text-smallest text-on-surface-tertiary">
      <ol class="flex flex-wrap items-center gap-1">
        <For each={props.crumbs}>
          {(crumb, index) => (
            <li class="flex items-center gap-1">
              <Show when={index() > 0}>
                <span aria-hidden="true">/</span>
              </Show>
              <Show when={crumb.to} fallback={<span>{crumb.label}</span>}>
                {(to) => (
                  <Link to={to()} class="no-underline hover:text-on-surface-secondary">
                    {crumb.label}
                  </Link>
                )}
              </Show>
            </li>
          )}
        </For>
      </ol>
    </nav>
  );
}
