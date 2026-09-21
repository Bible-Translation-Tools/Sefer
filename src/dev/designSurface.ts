/**
 * The annotator, mounted once for the whole application rather than only on
 * `/design`.
 *
 * The comment half of this tool has nothing to do with prototypes. "This input
 * does not autofocus when the dialog opens", "there should be a splitter
 * between these two panels" — those are remarks about the REAL screens, and
 * the point of pointing at a pixel is that you can do it wherever the pixel
 * is. So the panel goes up on every route.
 *
 * Gated by `__SEFER_DESIGN__`, which already means exactly "this build carries
 * the design surface" — dev always, `--mode design` for the deployed
 * prototype, production never. A second `INCLUDE_DESIGNER` switch would be two
 * names for one idea and one more thing to get out of step. Production is
 * deliberately not an option: comment mode swallows every event in the capture
 * phase, and shipping that to somebody editing scripture is a foot-gun, not a
 * feature.
 *
 * ## One instance, two configurations
 *
 * There is exactly one annotator. On an ordinary screen it has no variants and
 * no tweaks — a real screen declares none, and a panel offering knobs that do
 * nothing is worse than no panel — so it is comment-only, and starts minimised
 * as a puck, because on a real screen you are using the application rather
 * than designing it.
 *
 * `/design` then RECONFIGURES that same instance with its screen's variants,
 * tweaks and picker (`configureDesignSurface`) and hands over a state adapter
 * pointed at the router. Two annotators would be two panels; `update()` exists
 * for this.
 *
 * ## The hotkey
 *
 * `null` app-wide. A bare `c` over CodeMirror competes with the editor's own
 * bindings, and the editor is most of what this application is. `/design`
 * turns it back on when it takes over, because there the page is a prototype
 * and nothing else is listening.
 */

import {
  mountAnnotator,
  type Annotator,
  type AnnotatorOptions,
  type StateAdapter,
  type Tweak,
  type Variant,
} from "./annotate";

let annotator: Annotator | undefined;
/** What `/design` last asked for, so leaving it can be undone. */
let configured = false;

/**
 * Search params over `history`, for the routes that are not `/design`.
 *
 * Deliberately not the router: this is mounted from the root and must work on
 * every route without knowing any route's search type. Nothing outside
 * `/design` declares a tweak, so `write` is only ever reached if somebody adds
 * one — `replaceState` keeps that honest without a navigation.
 */
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
};

/**
 * The console and CDP handle, following `globalThis.__sefer` exactly as the
 * observability surface does — the repository's documented way to ask the
 * running application what it did.
 *
 * It exists because an agent attached over CDP can then skip the paste
 * entirely: `__sefer.design.drain()` is what the Copy button does, minus the
 * clipboard. The paste stays the channel that works everywhere (a deployed
 * prototype, a product owner's laptop); this is the shortcut for when the
 * agent happens to be on the same machine.
 *
 * Reading current values needs nothing from here — they are in the URL. What
 * this adds is the DECLARATIONS, which a URL cannot carry, and the ability to
 * act.
 */
const installHandle = (): void => {
  const held = globalThis.__sefer ?? {};
  held.design = {
    /** What this screen declares: the knobs that exist, not their values. */
    declarations: () => ({
      variants: currentOptions.variants ?? [],
      tweaks: currentOptions.tweaks ?? [],
    }),
    /** Every tweak and variant currently set, which is the URL. */
    values: () => currentOptions.state.read(),
    set: (key: string, value: string) => {
      const state = currentOptions.state;
      state.write({ ...state.read(), [key]: value });
      annotator?.sync();
    },
    comments: () => annotator?.comments() ?? [],
    /** Read the batch and clear it — the Copy button without the clipboard. */
    drain: () => annotator?.drain() ?? [],
    mode: () => annotator?.mode() ?? "interact",
    setMode: (next: "interact" | "comment") => {
      annotator?.setMode(next);
    },
    /** A real screen borrowing the panel for an afternoon; see `register`. */
    register,
  };
  globalThis.__sefer = held;
};

let currentOptions: AnnotatorOptions = BASE;

/**
 * What a real screen asked for, when it wants knobs without becoming a design
 * screen.
 *
 * `/design` is the place for a prototype, but iterating on a REAL screen
 * should not require copying it into `src/dev/design/screens/` first — by the
 * time the copy exists it is already a different file from the one that
 * ships, and whatever you learn has to be carried back by hand.
 *
 * So a screen can register its own knobs in place, and it does it through
 * `globalThis.__sefer.design` rather than an import. That is not a shortcut,
 * it is the only door available: `pnpm boundaries` forbids `src/app` from
 * importing `src/dev`, and rightly — but a global that simply is not there in
 * production is no import at all. The scaffolding reads
 *
 *     if (import.meta.env.DEV) {
 *       globalThis.__sefer?.design?.register({
 *         namespace: "bookEditor",
 *         tweaks: [{ key: "gutter", label: "Gutter", kind: "choice", options: ["narrow", "wide"] }],
 *         onChange: (values) => { setGutter(values["bookEditor.gutter"] ?? "narrow"); },
 *       });
 *     }
 *
 * and `onChange` is where it meets Solid: it is called once on registration
 * with the current values and again on every turn of a knob, so the body of it
 * is a `setSignal`. The annotator never learns what a signal is.
 *
 * This is TEMPORARY CODE by construction — it is scaffolding for an
 * afternoon's iteration, and `documentation/architecture/design.md` says so.
 * `pnpm design:scaffolding` lists every place it is still sitting, because the
 * failure mode of a pattern like this is not that it breaks, it is that
 * everybody forgets it is there.
 */
interface Registration {
  readonly namespace?: string;
  readonly variants?: readonly Variant[];
  readonly tweaks?: readonly Tweak[];
  readonly onChange?: (values: Readonly<Record<string, string>>) => void;
}

let registration: Registration | undefined;

/**
 * The URL adapter with a tap on it, so a registered screen hears about its own
 * knobs. Reads are untouched; only `write` grows the callback.
 */
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
  // Once on registration, so the screen starts in step with whatever the URL
  // already says rather than with its own defaults.
  asked.onChange?.(notifying.read());
  return () => {
    registration = undefined;
    releaseDesignSurface();
  };
};

export const startDesignSurface = (): (() => void) => {
  if (annotator !== undefined) return () => {};
  // NOT `BASE` — `currentOptions`. The root reaches this through a dynamic
  // import, so on a cold load of `/design` the screen's effect can run and call
  // `configureDesignSurface` before the import resolves. Mounting from `BASE`
  // here would silently throw that configuration away and leave the designer
  // looking at a puck with no knobs in it. Whatever was configured while we
  // were still loading is what comes up.
  annotator = mountAnnotator({ ...currentOptions, minimised: !configured });
  installHandle();
  return () => {
    annotator?.destroy();
    annotator = undefined;
    configured = false;
  };
};

/** `/design` taking the panel over for one screen. */
export const configureDesignSurface = (options: Partial<AnnotatorOptions>): void => {
  currentOptions = { ...BASE, ...options };
  configured = true;
  annotator?.update({ ...options, minimised: false });
};

/** Leaving `/design`: back to comment-only, and out of the way. */
export const releaseDesignSurface = (): void => {
  if (!configured) return;
  configured = false;
  currentOptions = BASE;
  annotator?.update({ ...BASE, variants: [], tweaks: [], nav: undefined, namespace: "" });
};

export const syncDesignSurface = (): void => {
  annotator?.sync();
};
