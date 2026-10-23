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

let registration: Registration | undefined;

const notifying: StateAdapter = {
  read: urlState.read,
  write: (next) => {
    urlState.write(next);
    registration?.onChange?.(next);
  },
};

const register = (asked: Registration): (() => void) => {
  registration = asked;
  configureDesignSurface({
    namespace: asked.namespace ?? "",
    variants: asked.variants ?? [],
    tweaks: asked.tweaks ?? [],
    state: notifying,
  });
  asked.onChange?.(notifying.read());
  return () => {
    registration = undefined;
    releaseDesignSurface();
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
