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

import { Effect, Option } from "effect";

import type { Book, Ref } from "../../core/book/book";
import type { FixPreview } from "../../core/fixes/fixes";
import type { Project } from "../../core/project/project";
import {
  ROLES,
  type LibraryService,
  type Passage,
  type Resource,
} from "../../core/resources/library";

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

// ---------------------------------------------------------------------------
// Key terms
//
// The other half of STET, and the one the design calls a multibuffer: a list
// of terms on the left, and on the right one pair of cards per occurrence —
// the source verse with the term highlighted, and the target verse, which is
// the editable one (design-direction.md, "Key terms / STET").
//
// What is real here is the SHAPE and the seam. A term list is a resource — a
// Translation Words container bound to the project under the `glossary` role —
// and the occurrences of a term in the source are that resource's business,
// not this file's. Neither is decoded yet, so `SAMPLE_TERMS` stands in and
// says so, and the occurrences are found by searching the project's own text.
// The moment a glossary is bound, `terms` is the function that changes and
// nothing above it is.
// ---------------------------------------------------------------------------

/** One key term, as the left-hand list shows it. */
export interface Term {
  /** Stable within a list. The term itself, today. */
  readonly id: string;
  readonly term: string;
  /** "This word can mean:" — the gloss bullets under an expanded term. */
  readonly glosses: readonly string[];
  /**
   * Occurrences the reviewer has already settled. There is no state store for
   * this yet; it is 0 until one exists, rather than a number we invented.
   */
  readonly done: number;
}

/**
 * A stand-in term list, used when the project has no glossary bound.
 *
 * Deliberately visible as a stand-in in the UI: a reviewer must never mistake
 * six hard-coded English words for their project's key terms.
 */
export const SAMPLE_TERMS: readonly Term[] = [
  { id: "God", term: "God", glosses: ["the one true God", "a god of the nations"], done: 0 },
  { id: "grace", term: "grace", glosses: ["undeserved favour", "a gift"], done: 0 },
  { id: "faith", term: "faith", glosses: ["trust in God", "the body of belief"], done: 0 },
  { id: "love", term: "love", glosses: ["steadfast commitment", "affection"], done: 0 },
  { id: "brother", term: "brother", glosses: ["a male sibling", "a fellow believer"], done: 0 },
  { id: "holy", term: "holy", glosses: ["set apart for God", "morally pure"], done: 0 },
];

/**
 * The resource this project reads as its SOURCE, or `none` when nothing is
 * bound. The view says so in as many words rather than substituting the
 * project's own text for a source it does not have — `Library.resolve` is
 * explicit about an empty binding for the same reason.
 */
export const sourceResource = (
  library: LibraryService,
  projectId: string,
): Effect.Effect<Option.Option<Resource>> =>
  Effect.map(library.resolve(projectId, ROLES.source), (found) => {
    const first = found[0];
    return first === undefined ? Option.none<Resource>() : Option.some(first);
  });

/** The source reading of one reference, when a source resource is bound. */
export const sourcePassage = (
  library: LibraryService,
  projectId: string,
  ref: Ref,
): Effect.Effect<Option.Option<Passage>> =>
  Effect.flatMap(sourceResource(library, projectId), (resource) =>
    Option.isNone(resource)
      ? Effect.succeed(Option.none())
      : library.lookup(resource.value.id, ref).pipe(Effect.orElseSucceed(() => Option.none())),
  );
