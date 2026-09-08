/**
 * Drafting (slice 22): the job level.
 *
 * A drafting job is not a new module — it is a named composition of the ones
 * that already exist, which is why it lives in the shell rather than in core.
 * What it composes, in order:
 *
 *   The Library resolves the project's `source` role to a resource, so the
 *   drafter has the text they are drafting FROM. Project hands out the target
 *   Books, and the editor seats the one on screen. The form the drafter fills
 *   is a per-book plan: which chapters, which projection to draft in, whether
 *   verse designators are immortal for the duration (a `lock-designators`
 *   projection, which is data in the registry, not a mode flag). Each accepted
 *   chunk is one `submit(changes, "drafting", …)` through the book's single
 *   write path, so the phases judge a drafted paragraph exactly as they judge a
 *   keystroke; Save's autosave and Recovery's journal follow from that with no
 *   further wiring. Progress is the census — chapters and verses per book — and
 *   a job is "done" when the target's census matches the source's, not when a
 *   counter says so. Nothing here is a second editor and nothing holds a
 *   second copy of the text.
 *
 * It is a stub because the missing piece is not code: it is the domain
 * vocabulary (the book code table, reference parsing) the seams list as
 * deliberately absent, plus the form's own design, which the owner has not
 * settled. Building it now would mean inventing both.
 */

import { Effect } from "effect";

import type { Project } from "../../core/project/project";

/** What a drafter chose: which books, which chapters, in which projection. */
export interface DraftingForm {
  readonly books: readonly string[];
  readonly chapters?: readonly number[];
  readonly projection?: string;
}

export interface Workflow {
  readonly id: string;
  readonly label: string;
  /** Fraction complete, from the census — never from a counter. */
  readonly progress: () => number;
}

export const draftingJob = (_project: Project, _form: DraftingForm): Effect.Effect<Workflow> =>
  // TODO(seam): compose Library.resolve + Project.instantiate + the drafting
  // projection, as described in this file's header. Dies rather than returning
  // an empty Workflow: a job that reports zero progress forever is worse than
  // one that says it does not exist.
  Effect.die(new Error("draftingJob: not implemented (seams §5.3, slice 22)"));
