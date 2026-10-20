import { createSignal } from "solid-js";

export type ToastTone = "info" | "success" | "error";

export interface Toast {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly message?: string;
  readonly loading: boolean;
  readonly dismissible: boolean;
  readonly action?: ToastAction;
}

export interface ToastAction {
  readonly label: string;
  readonly onPress: () => void;
}

export interface ToastOptions {
  readonly id?: string;
  readonly title: string;
  readonly message?: string;
  readonly tone?: ToastTone;
  readonly autoClose?: number | false;
  readonly dismissible?: boolean;
  readonly action?: ToastAction;
}

const [list, setList] = createSignal<readonly Toast[]>([], { name: "toasts" });

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

const show = (options: ToastOptions, loading = false): string => {
  const id = options.id ?? nextId();
  const toast: Toast = {
    id,
    tone: options.tone ?? "info",
    title: options.title,
    message: options.message,
    loading,
    dismissible: options.dismissible ?? true,
    ...(options.action === undefined ? {} : { action: options.action }),
  };
  setList((held) => [...held.filter((each) => each.id !== id), toast]);
  arm(id, loading ? false : options.autoClose);
  return id;
};

export const info = (options: ToastOptions): string => show({ ...options, tone: "info" });
export const success = (options: ToastOptions): string => show({ ...options, tone: "success" });
export const error = (options: ToastOptions): string =>
  show({ ...options, tone: "error", autoClose: options.autoClose ?? false });

export const progress = (options: ToastOptions): string => show(options, true);

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
            dismissible: options.dismissible ?? true,
          }
        : each,
    ),
  );
  arm(id, options.tone === "error" ? (options.autoClose ?? false) : options.autoClose);
};

export const advance = (id: string, options: Pick<ToastOptions, "title" | "message">): void => {
  setList((held) =>
    held.map((each) =>
      each.id === id ? { ...each, title: options.title, message: options.message } : each,
    ),
  );
};

export const dismiss = (id: string): void => {
  clearTimer(id);
  setList((held) => held.filter((each) => each.id !== id));
};
