import { Show, createSignal, onCleanup } from "solid-js";

import { t } from "../../i18n";

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
