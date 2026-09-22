/**
 * The notification manager: one module-level list, and the four calls that
 * change it.
 *
 * A module-level signal rather than a context, and deliberately: a toast is
 * raised from places that are not components — a command handler, a rejected
 * Effect, a progress stream — and threading a context through those would mean
 * inventing a second way to reach the shell. The list is the whole state;
 * `<Toaster />` is one reader of it.
 *
 * The API shape is ported from proto-2's `toastManager` (add / update / close,
 * a tone, a timeout, a loading flag for progress), not its CSS. The names are
 * shortened because there is one of each here.
 */

import { createSignal } from "solid-js";

export type ToastTone = "info" | "success" | "error";

export interface Toast {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly message?: string;
  /** A spinner instead of the tone icon; progress toasts never auto-close. */
  readonly loading: boolean;
  /**
   * Whether the × is offered. It always is, unless a caller deliberately says
   * otherwise: an error toast never auto-closes, so the close button is the
   * only way out of one, and a download that failed behind a progress toast
   * used to leave a permanent undismissable card on the screen.
   */
  readonly dismissible: boolean;
}

export interface ToastOptions {
  readonly id?: string;
  readonly title: string;
  readonly message?: string;
  readonly tone?: ToastTone;
  /** Milliseconds; `false` keeps it until something closes it. Default 5000. */
  readonly autoClose?: number | false;
  readonly dismissible?: boolean;
}

const [list, setList] = createSignal<readonly Toast[]>([], { name: "toasts" });

/** Every toast currently raised, oldest first. */
export const toastList = list;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `toast-${counter}`;
};

const clearTimer = (id: string): void => {
  const held = timers.get(id);
  if (held === undefined) return;
  clearTimeout(held);
  timers.delete(id);
};

const arm = (id: string, autoClose: number | false | undefined): void => {
  clearTimer(id);
  if (autoClose === false) return;
  timers.set(
    id,
    setTimeout(() => dismiss(id), autoClose ?? 5000),
  );
};

/** Raises one, or replaces the one already under `options.id`. */
export const show = (options: ToastOptions, loading = false): string => {
  const id = options.id ?? nextId();
  const toast: Toast = {
    id,
    tone: options.tone ?? "info",
    title: options.title,
    message: options.message,
    loading,
    dismissible: options.dismissible ?? true,
  };
  setList((held) => [...held.filter((each) => each.id !== id), toast]);
  arm(id, loading ? false : options.autoClose);
  return id;
};

export const info = (options: ToastOptions): string => show({ ...options, tone: "info" });
export const success = (options: ToastOptions): string => show({ ...options, tone: "success" });
export const error = (options: ToastOptions): string =>
  show({ ...options, tone: "error", autoClose: options.autoClose ?? false });

/**
 * A toast that stays and spins until `update` or `dismiss` ends it. It is
 * closable like every other one: a spinner the reader cannot get rid of is a
 * permanent card on the screen the first time a transfer fails.
 */
export const progress = (options: ToastOptions): string => show(options, true);

/**
 * Replaces a raised toast in place, keeping its position in the list.
 *
 * A toast the reader already closed is RE-RAISED when the update is an error,
 * and only then. Dismissing a spinner is a reasonable thing to do while a
 * clone runs; having done so must not be the reason the failure is never
 * reported. Anything else stays dismissed — a success nobody is waiting for is
 * not worth putting back on screen.
 */
export const update = (id: string, options: Omit<ToastOptions, "id">): void => {
  if (!list().some((each) => each.id === id)) {
    if (options.tone === "error") error({ ...options, id });
    return;
  }
  setList((held) =>
    held.map((each) =>
      each.id === id
        ? {
            ...each,
            tone: options.tone ?? each.tone,
            title: options.title,
            message: options.message,
            loading: false,
            // Whatever it was while it spun, a settled toast can be closed.
            dismissible: options.dismissible ?? true,
          }
        : each,
    ),
  );
  arm(id, options.tone === "error" ? (options.autoClose ?? false) : options.autoClose);
};

export const dismiss = (id: string): void => {
  clearTimer(id);
  setList((held) => held.filter((each) => each.id !== id));
};

export const dismissAll = (): void => {
  // The spread is a copy on purpose: `clearTimer` deletes from `timers`, so
  // this mutates the very map it walks. A Map iterator does define that case,
  // which is why the lint rule calls the copy useless — but the safety here
  // rests on a spec subtlety rather than on anything a reader can see, and the
  // copy costs one small array per "dismiss all".
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const id of [...timers.keys()]) clearTimer(id);
  setList([]);
};
