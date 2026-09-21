/**
 * What a design screen is.
 *
 * A screen is a page or a feature. It may declare VARIANTS — whole alternative
 * takes on it, the thing a segmented control switches between — and TWEAKS,
 * small named changes. A variant owns its own tweaks, because "cards" and
 * "table" do not usually have the same knobs; tweaks declared on the screen
 * itself apply whichever variant is showing and survive the switch.
 *
 * Both vocabularies come from `src/dev/annotate`, which is where the floating
 * panel that renders them lives. That is the right way round: the panel is a
 * general prototyping tool, and a screen is one thing it can drive.
 *
 * Deliberately smaller than the playground's `Experiment`: an experiment is
 * handed a `Bench` of real diffed USFM because it exists to judge an idea
 * against real text, and most of what a designer polishes — onboarding, empty
 * states, settings, the shape of a list — needs no text at all. Those screens
 * ship first and run anywhere, including a deployed worker with no filesystem.
 */

import type { JSX } from "@solidjs/web";

import type { Tweak, Variant } from "../annotate";

export interface ScreenProps {
  /** The showing variant's id, or `""` when the screen declares none. */
  readonly variant: () => string;
  /** A tweak's value: the showing variant's, else the screen's own. */
  readonly tweak: (key: string) => string;
  /** The same, for a `toggle`. */
  readonly on: (key: string) => boolean;
}

export interface Screen {
  /** Stable: it is the query parameter, the tweak namespace, and the `data-screen` hook. */
  readonly id: string;
  readonly title: string;
  /** One line under the title: what this screen is for. */
  readonly blurb: string;
  readonly variants?: readonly Variant[];
  /** Tweaks that apply whichever variant is showing. */
  readonly tweaks?: readonly Tweak[];
  readonly view: (props: ScreenProps) => JSX.Element;
}

/** A module in the glob is a screen if it exports one that looks like this. */
export const isScreen = (value: unknown): value is Screen => {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("view" in value)) return false;
  return typeof value.id === "string" && typeof value.view === "function";
};
