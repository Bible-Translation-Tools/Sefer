/**
 * What an experiment is, and what it is handed.
 *
 * The playground exists so a UI idea can be tried against REAL text without
 * first navigating to it, picking two sources, and clicking a book — and so
 * three variants of the same idea can sit beside each other while somebody
 * decides. It is `/rails`-style prototyping: the frame owns the plumbing, an
 * experiment owns a screen, and adding one is a file.
 *
 * An experiment is a plain object rather than a component, because the frame
 * needs to render its NAME and its DIALS before it renders the thing itself.
 * Dials are declared, not built: a prototype that has to hand-roll a toggle row
 * before it can show anything is a prototype nobody starts.
 */

import type { JSX } from "@solidjs/web";

import type { GalleyService } from "#core/galley";
import type { DiffSkeleton } from "#core/galley/diff";

import type { DialValues, Dials } from "../dials";

/**
 * Dials are `src/dev/dials.ts` now, shared with the `/design` frame — a knob on
 * a prototype is the same idea whichever frame is holding it, and two copies of
 * the type is how the two frames would start disagreeing about what a toggle
 * is. Re-exported rather than moved out of reach, so an experiment still writes
 * `import type { Dials } from "./experiment"` and does not have to know.
 */

export type { Dials, DialValues } from "../dials";

/**
 * Real project text, already diffed — the "half wired" part.
 *
 * `baseline` is the BEFORE side and `current` the AFTER, which is the engine's
 * own vocabulary (`core/galley/diff.ts`) and the same way round the review
 * screen holds it. Both are whole books of USFM; the skeleton is the decision
 * units over them, or `undefined` with `refusal` set when the engine had no
 * diff door.
 */
export interface Bench {
  readonly bookId: string;
  readonly baselineLabel: string;
  readonly currentLabel: string;
  readonly baselineText: string;
  readonly currentText: string;
  readonly skeleton: DiffSkeleton | undefined;
  readonly refusal: string | undefined;
  readonly galley: GalleyService;
}

export interface ExperimentProps {
  readonly bench: Bench | undefined;
  readonly dials: DialValues;
}

export interface Experiment {
  /** Stable; it is the remembered selection and the `data-experiment` hook. */
  readonly id: string;
  readonly title: string;
  /** One line under the title: what this variant is trying to find out. */
  readonly blurb: string;
  readonly dials?: Dials;
  readonly view: (props: ExperimentProps) => JSX.Element;
}

/** A module in the glob is an experiment if it exports one that looks like this. */
export const isExperiment = (value: unknown): value is Experiment => {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("view" in value)) return false;
  return typeof value.id === "string" && typeof value.view === "function";
};
