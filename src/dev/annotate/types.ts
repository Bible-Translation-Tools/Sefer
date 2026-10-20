import type { Hotkey } from "./hotkey.ts";

/** Where the panel sits. */
export type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export const CORNERS: readonly Corner[] = ["bottom-right", "bottom-left", "top-right", "top-left"];

/** What the pointer is currently for. */
export type Mode = "interact" | "comment";

/** A small named change: one knob, one value. */
export interface Tweak {
  readonly key: string;
  readonly label: string;
  readonly kind: "toggle" | "choice";
  /** `choice` only. */
  readonly options?: readonly string[];
  readonly initial?: string | boolean;
}

/** A whole alternative take on the page or feature — the thing a segmented control at the top of the panel switches between. */
export interface Variant {
  readonly id: string;
  readonly label: string;
  readonly tweaks?: readonly Tweak[];
}

/** Where values live. */
export interface StateAdapter {
  readonly read: () => Readonly<Record<string, string>>;
  readonly write: (next: Readonly<Record<string, string>>) => void;
  readonly subscribe?: (onChange: () => void) => () => void;
}

/** One element somebody pointed at. */
export interface Target {
  readonly id: string;
  /** From the `data-loc` stamp, when the JSX-location transform is running. */
  readonly source: string | null;
  /** A short CSS-ish path, for when there is no source location. */
  readonly selector: string;
  /** The element's own text, when it has any of its own. */
  readonly nearby: string;
  /** Its `data-*` attributes, which are usually what identifies it. */
  readonly data: string;
}

/** One thing somebody said, about one or more places. */
export interface Comment {
  readonly id: string;
  readonly text: string;
  /** At least one, in the order they were clicked. */
  readonly targets: readonly Target[];
  readonly url: string;
  readonly viewport: string;
  readonly theme: string;
  readonly at: number;
}

/** How much a copied batch says. */
export type Verbosity = "brief" | "full";

export interface AnnotatorOptions {
  /** Prefixes every state key, so two screens' tweaks cannot collide. */
  readonly namespace?: string;
  readonly variants?: readonly Variant[];
  /** Tweaks that apply whichever variant is showing. */
  readonly tweaks?: readonly Tweak[];
  readonly state: StateAdapter;
  /** Extra facts for a copied batch's header — a build id, which project is open. */
  readonly context?: () => Readonly<Record<string, string>>;
  readonly corner?: Corner;
  /** How much a copied batch says. */
  readonly verbosity?: Verbosity;
  /** The key that toggles comment mode. */
  readonly hotkey?: string | Hotkey | null;
  /** Start as a puck rather than an open panel. */
  readonly minimised?: boolean;
  /** An optional "which page am I on" control at the top of the panel. */
  readonly nav?: {
    readonly label: string;
    readonly items: readonly { readonly value: string; readonly label: string }[];
    readonly active: string;
    readonly choose: (value: string) => void;
  };
}

export interface Annotator {
  /** Re-read state and redraw the panel. */
  readonly sync: () => void;
  /** Swap variants/tweaks when the host moves to another screen. */
  readonly update: (options: Partial<AnnotatorOptions>) => void;
  readonly destroy: () => void;

  readonly comments: () => readonly Comment[];
  /** Read the batch and clear it: the Copy button, minus the clipboard. */
  readonly drain: () => readonly Comment[];
  readonly mode: () => Mode;
  readonly setMode: (next: Mode) => void;
}
