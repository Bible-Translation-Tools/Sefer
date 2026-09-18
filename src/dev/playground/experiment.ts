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

import type { GalleyService } from "../../core/galley";
import type { DiffSkeleton } from "../../core/galley/diff";

/** One control in the frame's dial bar. */
export type Dial =
  | { readonly kind: "toggle"; readonly label: string; readonly initial?: boolean }
  | {
      readonly kind: "choice";
      readonly label: string;
      readonly options: readonly string[];
      readonly initial?: string;
    };

export type Dials = Readonly<Record<string, Dial>>;

/**
 * What the dials currently say. Untyped per-key on purpose: an experiment reads
 * its own dials and knows their kinds, and a generic map is the price of not
 * making every prototype declare a type it will rename twice this afternoon.
 */
export interface DialValues {
  readonly toggle: (key: string) => boolean;
  readonly choice: (key: string) => string;
}

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
