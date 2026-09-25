/**
 * STET — "let it stand", the proofreader's mark — as Sefer ships it: the
 * key-terms catalogue behind the `/terms` screen. See
 * `documentation/architecture/stet.md`.
 *
 * Formatting transfer is not here: it is the Overlay ("Match formatting from
 * source"), a command on the text you are reading (`overlay.*` in
 * `src/app/commands.ts`), because it is an operation on the text rather than a
 * screen to go to. See `documentation/glossary.md`, "Overlay".
 */

import { Effect, Option } from "effect";

import type { BookId, Ref } from "#core/book/book";
import { Galley, tocViewOf, type Analysis } from "#core/galley";
import { versesAddress } from "#core/location/address";
import { resolve } from "#core/location/locate";
import { ROLES, type LibraryService, type Resource } from "#core/resources/library";
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
// The one the design calls a multibuffer: a list of terms on the left, and on
// the right one pair of cards per occurrence — the source verse with the term
// highlighted, and the target verse, which is the editable one
// (`documentation/architecture/design-direction.md`, "Key terms / STET"). It
// has its own route, `/terms`, because two panes read better than a toggle.
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
 * synchronously and reading a resource is an Effect. The guide answers for
 * almost everything — its whole point is that the readings are baked — so the
 * Library pass runs only over what is left, and short-circuits entirely when
 * no source resource is bound, which is the dev fixture's case.
 *
 * The Library pass reads each book once and asks the ENGINE where the verse
 * is: Sefer never reads a designator itself. What the card shows is the raw
 * USFM of the verse after its number, trimmed — character markers and all,
 * as it always has.
 */
export const sourceReadings = (
  library: LibraryService,
  projectId: string,
  occurrences: readonly TermOccurrence[],
): Effect.Effect<ReadonlyMap<string, SourceReading>, never, Galley> =>
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
    const galley = yield* Galley;
    // One parse per book, not per occurrence: a term's occurrences cluster.
    const books = new Map<BookId, Analysis | undefined>();
    for (const occurrence of missing) {
      if (!books.has(occurrence.book)) {
        const text = yield* library
          .readBook(resource.value.id, occurrence.book)
          .pipe(Effect.orElseSucceed(() => Option.none<string>()));
        books.set(
          occurrence.book,
          Option.isSome(text) ? galley.analyze(text.value, "stet.source") : undefined,
        );
      }
      const analysis = books.get(occurrence.book);
      const text = analysis === undefined ? undefined : verseReading(analysis, occurrence);
      if (text !== undefined) out.set(occurrence.sid, { text, origin: "library" });
    }
    return out;
  });

/**
 * One verse of a resource's book, as the card shows it: from the end of its
 * designator to the end of its structural extent, trimmed. `undefined` when
 * the book has no such verse, or has it twice — malformed text is not a
 * reason to pick one.
 */
const verseReading = (analysis: Analysis, occurrence: TermOccurrence): string | undefined => {
  const toc = tocViewOf(analysis);
  const point = { chapter: occurrence.chapter, verse: occurrence.verse };
  const found = resolve(toc, versesAddress(occurrence.book, point));
  if (found.kind !== "found") return undefined;
  // A found verse starts at its anchor, so the anchor is the one at `from`.
  const anchor = toc.verses.find((verse) => verse.at === found.from);
  return anchor === undefined ? undefined : analysis.text.slice(anchor.labelEnd, found.to).trim();
};

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
