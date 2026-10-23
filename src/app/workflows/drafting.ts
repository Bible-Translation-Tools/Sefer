// fallow-ignore-file unused-file

import { Effect } from "effect";

import type { Project } from "#core/project/project";

export interface DraftingForm {
  readonly books: readonly string[];
  readonly chapters?: readonly number[];
  readonly projection?: string;
}

export interface Workflow {
  readonly id: string;
  readonly label: string;
  readonly progress: () => number;
}

export const draftingJob = (_project: Project, _form: DraftingForm): Effect.Effect<Workflow> =>
  Effect.die(new Error("draftingJob: not implemented (seams §5.3, slice 22)"));
