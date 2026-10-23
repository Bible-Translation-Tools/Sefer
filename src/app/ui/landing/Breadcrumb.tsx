import { Link, type LinkProps } from "@tanstack/solid-router";
import { For, Show } from "solid-js";

export interface Crumb {
  readonly label: string;
  readonly to?: LinkProps["to"];
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
                  <Link
                    to={to()}
                    search={true}
                    class="no-underline hover:text-on-surface-secondary"
                  >
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
