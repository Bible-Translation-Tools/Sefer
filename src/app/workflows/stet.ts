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
import { StetCatalogFixtureLive } from "../../core/stet/fixture";
import {
  StetCatalog,
  type Guide,
  type Span,
  type StetError,
  type Term,
  type TermOccurrence,
} from "../../core/stet/stet";

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
// the editable one (design-direction.md, "Key terms / STET"). It has its own
// route, `/terms`, because Will asked for two panes rather than a toggle.
//
// This file is the join, and only the join. `src/core/stet` owns the
// catalogue — the schema, the guides, the occurrences — and knows nothing
// about a project; `src/core/excerpts` owns the mapping from a reference onto
// the project's own text. What is left for a workflow is deciding which
// source reading to show for an occurrence, and that is a decision with three
// answers in a fixed order: the guide's frozen reading, then a resource bound
// to the project under the `source` role, then nothing at all — said in as
// many words rather than papered over with the project's own text.
// ---------------------------------------------------------------------------

/**
 * The catalogue, with the fixture layer provided.
 *
 * Provided HERE rather than in `src/app/services.ts` on purpose: a guide is
 * megabytes of committed JSON behind a dynamic import, and nothing about the
 * application's boot should depend on it. Swapping the fixture for a Library
 * resource or a remote guides API is this one `Effect.provide`.
 */
const withCatalog = <A, E>(effect: Effect.Effect<A, E, StetCatalog>): Effect.Effect<A, E> =>
  Effect.provide(effect, StetCatalogFixtureLive);

/** The guides that can be loaded, named without loading any of them. */
export const keyTermGuides = (): Effect.Effect<readonly Guide[], StetError> =>
  withCatalog(Effect.flatMap(StetCatalog, (catalog) => catalog.guides()));

/** Every key term of one guide, occurrences attached. */
export const keyTerms = (locale?: string): Effect.Effect<readonly Term[], StetError> =>
  withCatalog(Effect.flatMap(StetCatalog, (catalog) => catalog.terms(locale)));

/** The reference an occurrence names, in the vocabulary the shell navigates by. */
export const occurrenceRef = (occurrence: TermOccurrence): Ref => ({
  book: occurrence.book,
  chapter: occurrence.chapter,
  verse: occurrence.verse,
});

/** What the source card shows for one occurrence, and where it came from. */
export interface SourceReading {
  readonly text: string;
  /** Highlight ranges into `text`. The guide's; a bound resource has none. */
  readonly spans?: readonly Span[];
  readonly origin: "guide" | "library";
}

/**
 * The source reading for every occurrence that has one, keyed by sid.
 *
 * Resolved once per term rather than per card because the card renders
 * synchronously and a lookup is an Effect. The guide answers for almost
 * everything — its whole point is that the readings are baked — so the Library
 * pass runs only over what is left, and short-circuits entirely when no source
 * resource is bound, which is the dev fixture's case.
 */
export const sourceReadings = (
  library: LibraryService,
  projectId: string,
  occurrences: readonly TermOccurrence[],
): Effect.Effect<ReadonlyMap<string, SourceReading>> =>
  Effect.gen(function* () {
    const out = new Map<string, SourceReading>();
    const missing: TermOccurrence[] = [];
    for (const occurrence of occurrences) {
      if (occurrence.sourceText === undefined) {
        missing.push(occurrence);
        continue;
      }
      out.set(occurrence.sid, {
        text: occurrence.sourceText,
        origin: "guide",
        ...(occurrence.spans === undefined ? {} : { spans: occurrence.spans }),
      });
    }
    if (missing.length === 0) return out;

    const resource = yield* sourceResource(library, projectId);
    if (Option.isNone(resource)) return out;
    for (const occurrence of missing) {
      const passage = yield* library
        .lookup(resource.value.id, occurrenceRef(occurrence))
        .pipe(Effect.orElseSucceed(() => Option.none<Passage>()));
      if (Option.isSome(passage))
        out.set(occurrence.sid, { text: passage.value.text, origin: "library" });
    }
    return out;
  });

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
