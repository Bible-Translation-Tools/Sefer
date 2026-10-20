import type { JSX } from "@solidjs/web";

import type { GalleyService } from "#core/galley";
import type { DiffSkeleton } from "#core/galley/diff";

import type { DialValues, Dials } from "../dials";

export type { Dials, DialValues } from "../dials";

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
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly dials?: Dials;
  readonly view: (props: ExperimentProps) => JSX.Element;
}

export const isExperiment = (value: unknown): value is Experiment => {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("view" in value)) return false;
  return typeof value.id === "string" && typeof value.view === "function";
};
