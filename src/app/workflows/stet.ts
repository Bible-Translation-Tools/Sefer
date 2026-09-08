/**
 * STET (slice 27): formatting transfer, and comparison against a reference.
 *
 * "STET" is the proofreader's mark meaning "let it stand". The job it names
 * here is the reverse of drafting: the text is already right, and what must be
 * carried across is the FORMATTING — paragraph breaks, poetry indentation,
 * section headings — from a source book to a target that has the same words
 * arranged as one undifferentiated run.
 *
 * What it composes: Galley parses both books, so both `Analysis` products name
 * the same verses through their tables of contents. Alignment is therefore by
 * REFERENCE, never by offset — the two texts have different lengths, and every
 * derived product in Sefer is stamped to the text it came from. For each
 * aligned verse boundary in the source that carries a paragraph marker, the
 * transfer is one insertion in the target, and the whole set becomes
 * `FixPreview[]` — the same shape the findings panel previews and applies, so
 * the reviewer sees each change before it lands and the fix machinery does the
 * staleness checking. Applying them is `fixes.applyAll` over one book: one
 * change list, one receipt, one undo step.
 *
 * `stetCompare` is the read-only half: the same alignment, reported as a
 * Comparison the reviewer reads side by side against a Library resource, with
 * no edits offered.
 *
 * It is a stub because the alignment rules are the domain owner's: which
 * markers transfer, what happens at a verse the target has split or merged,
 * and how a mismatch is reported are decisions this file must not invent.
 */

import { Effect } from "effect";

import type { Book } from "../../core/book/book";
import type { FixPreview } from "../../core/fixes/fixes";
import type { Project } from "../../core/project/project";
import type { Resource } from "../../core/resources/library";

/** Per-reference agreement between a project book and a reference resource. */
export interface Comparison {
  readonly resourceId: string;
  readonly agreed: number;
  readonly differing: readonly string[];
}

export const matchFormatting = (
  _source: Book,
  _target: Book,
): Effect.Effect<readonly FixPreview[]> =>
  // TODO(seam): align by Ref through both analyses' tables of contents and
  // emit one FixPreview per transferable marker. Dies rather than returning
  // `[]`, which would read as "the two books already agree".
  Effect.die(new Error("matchFormatting: not implemented (seams §5.3, slice 27)"));

export const stetCompare = (_project: Project, _resource: Resource): Effect.Effect<Comparison> =>
  // TODO(seam): the read-only half of the same alignment.
  Effect.die(new Error("stetCompare: not implemented (seams §5.3, slice 27)"));
