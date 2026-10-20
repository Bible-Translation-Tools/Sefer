import type { BookId } from "@sefer/text/book";
import { resolve } from "@sefer/text/location/locate";
import { Effect, Option } from "effect";

import { Galley, tocViewOf, type Analysis } from "#core/galley";
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

const withCatalog = <A, E>(effect: Effect.Effect<A, E, StetCatalog>): Effect.Effect<A, E> =>
  Effect.provide(effect, StetCatalogFixtureLive);

export const keyTermGuides = (): Effect.Effect<readonly Guide[], StetError> =>
  withCatalog(Effect.flatMap(StetCatalog, (catalog) => catalog.guides()));

export const keyTerms = (locale?: string): Effect.Effect<readonly Term[], StetError> =>
  withCatalog(Effect.flatMap(StetCatalog, (catalog) => catalog.terms(locale)));

export interface SourceReading {
  readonly text: string;
  readonly spans?: readonly Span[];
  readonly origin: "guide" | "library";
}

export const sourceReadings = (
  library: LibraryService,
  projectRoot: string,
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

    const resource = yield* sourceResource(library, projectRoot);
    if (Option.isNone(resource)) return out;
    const galley = yield* Galley;
    const books = new Map<BookId, Analysis | undefined>();
    for (const occurrence of missing) {
      const book = occurrence.address.book;
      if (!books.has(book)) {
        const text = yield* library
          .readBook(resource.value.id, book)
          .pipe(Effect.orElseSucceed(() => Option.none<string>()));
        books.set(
          book,
          Option.isSome(text) ? galley.analyze(text.value, "stet.source") : undefined,
        );
      }
      const analysis = books.get(book);
      const text = analysis === undefined ? undefined : verseReading(analysis, occurrence);
      if (text !== undefined) out.set(occurrence.sid, { text, origin: "library" });
    }
    return out;
  });

const verseReading = (analysis: Analysis, occurrence: TermOccurrence): string | undefined => {
  const toc = tocViewOf(analysis);
  const found = resolve(toc, occurrence.address);
  if (found.kind !== "found") return undefined;
  const anchor = toc.verses.find((verse) => verse.at === found.from);
  return anchor === undefined ? undefined : analysis.text.slice(anchor.labelEnd, found.to).trim();
};

const sourceResource = (
  library: LibraryService,
  projectRoot: string,
): Effect.Effect<Option.Option<Resource>> =>
  Effect.map(library.resolve(projectRoot, ROLES.source), (found) => {
    const first = found[0];
    return first === undefined ? Option.none<Resource>() : Option.some(first);
  });
