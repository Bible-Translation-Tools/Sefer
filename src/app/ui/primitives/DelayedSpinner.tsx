/**
 * What a wait looks like: nothing, and then — only if it is still waiting
 * after `PENDING_MS` — a spinner.
 *
 * Most waits here are well under a second, and a word that flashes up and
 * vanishes reads as something the reader missed. So the first stretch of any
 * wait is a blank shell, and the spinner is for a machine under load. No text,
 * for the same reason.
 *
 * Not to be confused with Solid 2's own vocabulary: `<Loading>` is the
 * first-render boundary and `isPending` is revalidation. This is only what
 * such a fallback draws.
 */

import { Show, createSignal, onCleanup } from "solid-js";

import { t } from "../../i18n";

/** How long a wait stays blank before it shows a spinner. */
export const PENDING_MS = 750;

export function DelayedSpinner() {
  const [late, setLate] = createSignal(false);
  const timer = setTimeout(() => setLate(true), PENDING_MS);
  onCleanup(() => clearTimeout(timer));

  return (
    <div data-delayed-spinner class="flex h-full min-h-24 w-full items-center justify-center">
      <Show when={late()}>
        <span
          role="status"
          aria-label={t("Loading")}
          class="size-5 animate-spin rounded-full border-2 border-on-surface-tertiary border-t-transparent"
        />
      </Show>
    </div>
  );
}
