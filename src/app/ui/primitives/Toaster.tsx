/**
 * The viewport for `toasts.ts` — mounted once, near the root.
 *
 * `role="status"` with `aria-live="polite"` on the region, so a raised toast is
 * announced without stealing focus. An error toast never auto-closes (see
 * `toasts.error`), which is why the close button is the only way out of one.
 */

import Check from "lucide-solid/icons/check";
import Info from "lucide-solid/icons/info";
import LoaderCircle from "lucide-solid/icons/loader-circle";
import X from "lucide-solid/icons/x";
import { For, Show } from "solid-js";

import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { dismiss, toastList, type Toast } from "./toasts";

const tone = (toast: Toast): string => {
  if (toast.tone === "error") return "border-on-surface-error/30 bg-surface-error";
  if (toast.tone === "success") return "border-on-surface-success/30 bg-surface-success";
  return "border-surface-border bg-surface-primary";
};

const icon = (toast: Toast) => {
  if (toast.loading) return <LoaderCircle size={16} class="animate-spin" />;
  if (toast.tone === "error") return <X size={16} class="text-on-surface-error" />;
  if (toast.tone === "success") return <Check size={16} class="text-on-surface-success" />;
  return <Info size={16} class="text-on-surface-tertiary" />;
};

export function Toaster() {
  return (
    <div
      role="status"
      aria-live="polite"
      class="pointer-events-none fixed bottom-4 end-4 z-50 flex w-[min(24rem,90vw)] flex-col gap-2"
    >
      <For each={toastList()}>
        {(toast) => (
          <div
            data-toast={toast.id}
            data-tone={toast.tone}
            class={cx(
              "pointer-events-auto flex items-start gap-2 rounded-lg border p-3 shadow-medium",
              tone(toast),
            )}
          >
            <span aria-hidden="true" class="mt-px shrink-0">
              {icon(toast)}
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-small font-medium text-on-surface-primary">{toast.title}</p>
              <Show when={toast.message}>
                {(message) => (
                  <p class="mt-0.5 text-smallest break-words text-on-surface-tertiary">
                    {message()}
                  </p>
                )}
              </Show>
            </div>
            <Show when={toast.dismissible}>
              <IconButton
                label="Dismiss"
                size="sm"
                icon={<X size={14} />}
                onClick={() => dismiss(toast.id)}
              />
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
