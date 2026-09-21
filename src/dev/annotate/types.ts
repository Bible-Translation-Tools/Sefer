/**
 * The annotator's public shape — what a host hands it, and what it hands back.
 *
 * This folder is a plain DOM module. No Solid, no router, no Sefer: a design
 * tool that only works in one application is a design tool you rewrite for the
 * next one. `pnpm boundaries` runs `src/core`'s own rule set over it, so
 * `solid-js` and friends are not merely discouraged here, they fail the build.
 *
 * The seam that makes that possible is `StateAdapter`. The annotator never
 * decides where a tweak's value lives; it asks. In Sefer that is the router's
 * search params, so every knob is in a URL somebody can send. In a project with
 * no router it could be `localStorage` or a plain object, and nothing in here
 * changes.
 */

/** Where the panel sits. A kebab menu moves it; a designer works in a corner. */
export type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export const CORNERS: readonly Corner[] = ["bottom-right", "bottom-left", "top-right", "top-left"];

/**
 * What the pointer is currently for.
 *
 * `comment` is a MODE in the strong sense: while it is on, the application
 * cannot be operated at all. Every event is taken in the capture phase, so a
 * click selects an element instead of pressing the button under it. That is
 * deliberate — a half-mode where some clicks fall through is how somebody ends
 * up filing a bug about the application being broken.
 */
export type Mode = "interact" | "comment";

/** A small named change: one knob, one value. */
export interface Tweak {
  readonly key: string;
  readonly label: string;
  readonly kind: "toggle" | "choice";
  /** `choice` only. The first is the default when `initial` is absent. */
  readonly options?: readonly string[];
  readonly initial?: string | boolean;
}

/**
 * A whole alternative take on the page or feature — the thing a segmented
 * control at the top of the panel switches between.
 *
 * A variant owns its own tweaks, because "table layout" and "card layout" do
 * not usually have the same knobs. Tweaks that DO apply whichever variant is
 * showing go in `AnnotatorOptions.tweaks` instead, and stay put as you switch.
 */
export interface Variant {
  readonly id: string;
  readonly label: string;
  readonly tweaks?: readonly Tweak[];
}

/**
 * Where values live. The host owns this, which is what keeps the annotator
 * free of any particular framework's idea of state.
 *
 * `read` must return the CURRENT values every time it is called — the panel
 * calls it while rendering. `subscribe` is optional: without it the host is
 * expected to call `sync()` after it changes state itself.
 */
export interface StateAdapter {
  readonly read: () => Readonly<Record<string, string>>;
  readonly write: (next: Readonly<Record<string, string>>) => void;
  readonly subscribe?: (onChange: () => void) => () => void;
}

/** One thing somebody pointed at and said something about. */
export interface Comment {
  readonly id: string;
  readonly text: string;
  /** From the `data-loc` stamp, when the JSX-location transform is running. */
  readonly source: string | null;
  /** A short CSS-ish path, for when there is no source location. */
  readonly selector: string;
  /** Visible text near the click, to identify the thing in prose. */
  readonly nearby: string;
  readonly url: string;
  readonly viewport: string;
  readonly theme: string;
  readonly at: number;
}

/** How much a copied batch says. Two levels, because three is a menu nobody reads. */
export type Verbosity = "brief" | "full";

export interface AnnotatorOptions {
  /** Prefixes every state key, so two screens' tweaks cannot collide. */
  readonly namespace?: string;
  readonly variants?: readonly Variant[];
  /** Tweaks that apply whichever variant is showing. */
  readonly tweaks?: readonly Tweak[];
  readonly state: StateAdapter;
  /**
   * Extra facts for a copied batch's header — a build id, which project is
   * open. A function because they change; the annotator reads it when copying.
   */
  readonly context?: () => Readonly<Record<string, string>>;
  readonly corner?: Corner;
  /**
   * The key that toggles comment mode. `"c"` by default, `null` for no hotkey
   * at all — click the segmented control instead.
   *
   * Configurable rather than fixed because a bare letter is a different
   * proposition depending on what it is floating over. On a design surface,
   * where the page is a prototype and nothing else is listening, `c` is worth
   * having. Over a real editor — Sefer's CodeMirror, say — a single letter
   * competes with the application's own bindings, and `null` is the honest
   * setting. `Escape` always leaves comment mode regardless, because an exit
   * you cannot find is worse than no shortcut at all.
   */
  readonly hotkey?: string | null;
  /**
   * An optional "which page am I on" control at the top of the panel.
   *
   * Kept deliberately generic — a list of labels and a callback — because the
   * annotator must not learn what a Sefer design screen is. It exists at all
   * because the alternative is a navigation bar pinned across the top of the
   * page, and a prototyping tool that covers the thing being judged has got
   * the wrong end of its own job.
   */
  readonly nav?: {
    readonly label: string;
    readonly items: readonly { readonly value: string; readonly label: string }[];
    readonly active: string;
    readonly choose: (value: string) => void;
  };
}

export interface Annotator {
  /** Re-read state and redraw the panel. Call after the host changes state. */
  readonly sync: () => void;
  /** Swap variants/tweaks when the host moves to another screen. */
  readonly update: (options: Partial<AnnotatorOptions>) => void;
  readonly destroy: () => void;
}
