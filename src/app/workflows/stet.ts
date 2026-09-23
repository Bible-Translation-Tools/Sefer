/**
 * STET — "let it stand", the proofreader's mark — as Sefer ships it: key
 * terms, the `/terms` screen.
 *
 * Formatting transfer used to be planned as STET's other half and to live
 * here. It does not: it is the Overlay ("Match formatting from source"), a
 * command on the text you are reading (`overlay.*` in `src/app/commands.ts`),
 * because it is an operation on the text rather than a screen to go to. See
 * `documentation/glossary.md`, "Overlay".
 */

import { Effect, Option } from "effect";

import type { Ref } from "#core/book/book";
import { ROLES, type LibraryService, type Passage, type Resource } from "#core/resources/library";
import { StetCatalogFixtureLive } from "#core/stet/fixture";
import {
  StetCatalog,
  type Guide,
  type Span,
  type StetError,
  type Term,
  type TermOccurrence,
} from "#core/stet/stet";

// ---------------------------------------------------------------------------
// Key terms
//
// The one the design calls a multibuffer: a list
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
const sourceResource = (
  library: LibraryService,
  projectId: string,
): Effect.Effect<Option.Option<Resource>> =>
  Effect.map(library.resolve(projectId, ROLES.source), (found) => {
    const first = found[0];
    return first === undefined ? Option.none<Resource>() : Option.some(first);
  });
