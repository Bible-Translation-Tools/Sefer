/**
 * What a design screen is.
 *
 * Deliberately smaller than the playground's `Experiment`: an experiment is
 * handed a `Bench` of real diffed USFM because it exists to judge an idea
 * against real text, and most of what a designer polishes — onboarding, empty
 * states, settings, the shape of a list — needs no text at all. Those screens
 * ship first and run anywhere, including a deployed worker with no filesystem.
 *
 * A screen that DOES need scripture gets it the way the playground does, from
 * a project the shell has already opened. That tier is not wired here yet and
 * is the last stage of the plan rather than the first.
 *
 * A screen is a plain object rather than a component because the frame renders
 * its name and its dials before it renders the screen itself, and because
 * declaring a dial should be one line rather than a hand-rolled toggle row.
 */

import type { JSX } from "@solidjs/web";

import type { DialValues, Dials } from "../dials";

export interface ScreenProps {
  readonly dials: DialValues;
}

export interface Screen {
  /** Stable: it is the query parameter, the dial namespace, and the `data-screen` hook. */
  readonly id: string;
  readonly title: string;
  /** One line under the title: what this screen is for. */
  readonly blurb: string;
  readonly dials?: Dials;
  readonly view: (props: ScreenProps) => JSX.Element;
}

/** A module in the glob is a screen if it exports one that looks like this. */
export const isScreen = (value: unknown): value is Screen => {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("view" in value)) return false;
  return typeof value.id === "string" && typeof value.view === "function";
};
