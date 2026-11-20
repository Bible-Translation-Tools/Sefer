import {
  mountAnnotator,
  type Annotator,
  type AnnotatorOptions,
  type StateAdapter,
  type Tweak,
  type Variant,
} from "./annotate";

let annotator: Annotator | undefined;
let configured = false;

const urlState: StateAdapter = {
  read: () => Object.fromEntries(new URLSearchParams(location.search)),
  write: (next) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) params.set(key, value);
    const query = params.toString();
    history.replaceState(history.state, "", query === "" ? location.pathname : `?${query}`);
  },
};

const BASE: AnnotatorOptions = {
  state: urlState,
  hotkey: null,
  minimised: true,
  verbosity: import.meta.env.DEV ? "brief" : "full",
};

const installHandle = (): void => {
  const held = globalThis.__sefer ?? {};
  held.design = {
    declarations: () => ({
      variants: currentOptions.variants ?? [],
      tweaks: currentOptions.tweaks ?? [],
    }),
    values: () => currentOptions.state.read(),
    set: (key: string, value: string) => {
      const state = currentOptions.state;
      state.write({ ...state.read(), [key]: value });
      annotator?.sync();
    },
    comments: () => annotator?.comments() ?? [],
    drain: () => annotator?.drain() ?? [],
    mode: () => annotator?.mode() ?? "interact",
    setMode: (next: "interact" | "comment") => {
      annotator?.setMode(next);
    },
    register,
  };
  globalThis.__sefer = held;
};

let currentOptions: AnnotatorOptions = BASE;

interface Registration {
  readonly namespace?: string;
  readonly variants?: readonly Variant[];
  readonly tweaks?: readonly Tweak[];
  readonly onChange?: (values: Readonly<Record<string, string>>) => void;
}

/**
 * Every live registration, oldest first. A screen and the app bar can both
 * register (Review's states and the Sync chip's): when none of them brings
 * variants, their tweaks show together, each keyed under its own namespace
 * exactly as it would be alone. Variants are one screen's at a time, so the
 * newest registration that has them takes the panel.
 */
const registrations: Registration[] = [];

const notifying: StateAdapter = {
  read: urlState.read,
  write: (next) => {
    urlState.write(next);
    // A copy: a change can mount or unmount a screen, which registers or releases.
    for (const each of registrations.slice()) each.onChange?.(next);
  },
};

const prefixedKey = (namespace: string | undefined, key: string): string =>
  namespace === undefined || namespace === "" ? key : `${namespace}.${key}`;

const configureFromRegistrations = (): void => {
  const withVariants = registrations.findLast((each) => (each.variants ?? []).length > 0);
  if (withVariants !== undefined) {
    configureDesignSurface({
      namespace: withVariants.namespace ?? "",
      variants: withVariants.variants ?? [],
      tweaks: withVariants.tweaks ?? [],
      state: notifying,
    });
    return;
  }
  if (registrations.length === 0) {
    releaseDesignSurface();
    return;
  }
  configureDesignSurface({
    namespace: "",
    variants: [],
    tweaks: registrations.flatMap((each) =>
      (each.tweaks ?? []).map((tweak) => ({
        ...tweak,
        key: prefixedKey(each.namespace, tweak.key),
      })),
    ),
    state: notifying,
  });
};

const register = (asked: Registration): (() => void) => {
  registrations.push(asked);
  configureFromRegistrations();
  asked.onChange?.(notifying.read());
  return () => {
    const at = registrations.indexOf(asked);
    if (at === -1) return;
    registrations.splice(at, 1);
    configureFromRegistrations();
  };
};

export const startDesignSurface = (): (() => void) => {
  if (annotator !== undefined) return () => {};
  annotator = mountAnnotator({ ...currentOptions, minimised: !configured });
  installHandle();
  return () => {
    annotator?.destroy();
    annotator = undefined;
    configured = false;
  };
};

export const configureDesignSurface = (options: Partial<AnnotatorOptions>): void => {
  currentOptions = { ...BASE, ...options };
  configured = true;
  annotator?.update({ ...options, minimised: false });
};

export const releaseDesignSurface = (): void => {
  if (!configured) return;
  configured = false;
  currentOptions = BASE;
  annotator?.update({ ...BASE, variants: [], tweaks: [], nav: undefined, namespace: "" });
};

export const syncDesignSurface = (): void => {
  annotator?.sync();
};
