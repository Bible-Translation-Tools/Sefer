/**
 * Key terms (STET): the catalogue, and the port that serves it.
 *
 * A key-terms guide is a **frozen, self-contained snapshot**, not something
 * this application derives. A generator pins a Gateway Language translation at
 * a commit, pulls the plain reading of every verse a term is recorded in, and
 * precomputes the offsets inside those readings where the term's glosses
 * matched. What arrives here is the result: verse text and highlight ranges
 * already baked, so nothing at read time fetches an archive or re-runs a
 * matcher (`fixtures/stet/README.md` has the provenance).
 *
 * Two things this module is, and one it is not.
 *
 *  - It is the **trust boundary**. The envelope on disk is decoded through
 *    `StetEnvelope` before a single field reaches a caller, the way every
 *    resource metadata value goes through `src/core/resources`. Whoever read
 *    the bytes — a `?raw` fixture today, a Library resource or a guides API
 *    tomorrow — hands them here as `unknown` and gets `Term[]` back or a
 *    refusal.
 *  - It is the **flattening**. The envelope stores verse text once, in
 *    `referenceVerses`, and each term names verses by sid; a caller wants the
 *    term with its occurrences and their text attached. `termsOf` does that
 *    join once per guide, so the view never holds two collections that have to
 *    agree.
 *  - It is NOT the mapping onto a project. An occurrence names a reference,
 *    and turning a reference into a span of the target book's own text is
 *    `core/excerpts`' `refOccurrences` — the guide knows nothing about the
 *    project, which is the whole point of comparing against it.
 */

import { Context, Data, Effect, Option, Result, Schema } from "effect";

import type { BookId } from "../book/book";

// ---------------------------------------------------------------------------
// The envelope, as it is written
// ---------------------------------------------------------------------------

/** A `[start, end)` pair, as the generator writes it. */
const Range = Schema.Tuple([Schema.Number, Schema.Number]);

const EnvelopeTerm = Schema.Struct({
  term: Schema.String,
  englishTerm: Schema.String,
  strongs: Schema.Array(Schema.Number),
  definition: Schema.String,
  /** The curated evaluation set: the verses a reviewer is asked to look at. */
  subsetVerses: Schema.Array(
    Schema.Struct({
      ref: Schema.String,
      sameTranslationGroup: Schema.optionalKey(Schema.String),
    }),
  ),
  /** Every verse the term is recorded in. A superset of the curated set. */
  exhaustiveVerses: Schema.Array(Schema.String),
  /** Display and diagnostics only; the matching already happened offline. */
  glosses: Schema.Array(Schema.String),
  /** Per sid, sorted non-overlapping offsets into `referenceVerses[sid]`. */
  glossRanges: Schema.Record(Schema.String, Schema.Array(Range)),
});

const StetEnvelope = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  locale: Schema.String,
  reference: Schema.Struct({
    /** The pinned commit of the snapshot the offsets were computed against. */
    provenanceId: Schema.String,
    displayName: Schema.String,
    sourceUrl: Schema.optionalKey(Schema.String),
  }),
  /** The frozen reading of every referenced verse, deduped across terms. */
  referenceVerses: Schema.Record(Schema.String, Schema.String),
  terms: Schema.Array(EnvelopeTerm),
});

type StetEnvelope = typeof StetEnvelope.Type;

/** One row of the guide manifest: a locale that can be loaded, unloaded. */
const StetManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  guides: Schema.Array(
    Schema.Struct({
      locale: Schema.String,
      displayName: Schema.String,
      provenanceId: Schema.String,
      file: Schema.String,
    }),
  ),
});

type StetManifest = typeof StetManifest.Type;

// ---------------------------------------------------------------------------
// The shape callers see
// ---------------------------------------------------------------------------

/** A guide the catalogue can serve, named without loading it. */
export interface Guide {
  readonly locale: string;
  /** "English ULB (en_ulb)". */
  readonly displayName: string;
  /** The pinned commit of the translation the readings were taken from. */
  readonly provenanceId: string;
  readonly sourceUrl?: string;
}

/** A `[from, to)` range inside an occurrence's `sourceText`. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * One recorded use of a term, in the SOURCE.
 *
 * `sourceText` is the frozen Gateway Language reading of that verse and
 * `spans` index into it — never into the project's own text, which the guide
 * has never seen. Both are optional because a guide may record a reference
 * whose reading the generator could not extract, and a missing reading is a
 * fact the view must be able to state.
 */
export interface TermOccurrence {
  readonly book: BookId;
  readonly chapter: number;
  readonly verse: number;
  /** `PHM 1:5` — the canonical single-verse sid the guide names. */
  readonly sid: string;
  readonly sourceText?: string;
  readonly spans?: readonly Span[];
  /**
   * Is this one of the curated evaluation verses, rather than merely one of
   * the recorded ones? The old application made that an "exhaustive" toggle;
   * here it is a property of the occurrence, and the view may do with it what
   * it likes.
   */
  readonly curated: boolean;
}

/** One key term, with every occurrence the guide records for it. */
export interface Term {
  /** Stable within a guide: the English term, slugged, disambiguated. */
  readonly id: string;
  /** The term in the guide's own language. */
  readonly term: string;
  readonly englishTerm: string;
  /** "This word can mean:" — the bullets under an expanded term. */
  readonly glosses: readonly string[];
  readonly definition: string;
  readonly strongs?: readonly number[];
  readonly occurrences: readonly TermOccurrence[];
  /**
   * Occurrences the reviewer has settled. There is no store for this yet, so
   * it is 0 — a number we did not invent rather than one we did.
   */
  readonly done: number;
}

/** A guide that could not be read, decoded, or found. */
export class StetError extends Data.TaggedError("StetError")<{
  readonly locale: string;
  readonly reason: string;
}> {}

/**
 * Where key terms come from.
 *
 * Deliberately narrow: four reads, no writes, no notion of a project. A Live
 * layer backed by the committed fixture is in `./fixture.ts`; a Library
 * resource under the `glossary` role, or a remote guides API, is another layer
 * and nothing above this interface changes when one arrives.
 */
interface StetCatalogService {
  /** The guides that can be loaded, without loading any of them. */
  readonly guides: () => Effect.Effect<readonly Guide[], StetError>;
  /** Every term of one guide, in the order the guide lists them. */
  readonly terms: (locale?: string) => Effect.Effect<readonly Term[], StetError>;
  readonly term: (id: string, locale?: string) => Effect.Effect<Option.Option<Term>, StetError>;
  readonly occurrences: (
    termId: string,
    locale?: string,
  ) => Effect.Effect<readonly TermOccurrence[], StetError>;
}

export class StetCatalog extends Context.Service<StetCatalog, StetCatalogService>()(
  "StetCatalog",
) {}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

const decodeEnvelope = Schema.decodeUnknownResult(StetEnvelope);
const decodeManifest = Schema.decodeUnknownResult(StetManifest);

/** `PHM 1:5`, and nothing looser. Ranges and chapter-only refs are refused. */
const SID = /^([A-Z0-9]{3})[ \t]+(\d+):(\d+)$/;

interface ParsedSid {
  readonly book: BookId;
  readonly chapter: number;
  readonly verse: number;
  readonly sid: string;
}

/** The canonical single verse a sid names, or `undefined` for anything else. */
const parseSid = (raw: string): ParsedSid | undefined => {
  const found = SID.exec(raw.trim());
  if (found === null) return undefined;
  const book = found[1] ?? "";
  const chapter = Number(found[2]);
  const verse = Number(found[3]);
  if (chapter < 1 || verse < 1) return undefined;
  return { book, chapter, verse, sid: `${book} ${chapter}:${verse}` };
};

const SLUG = /[^a-z0-9]+/g;

/**
 * A term's id: its English label, slugged, with a counter on collision.
 *
 * The upstream data has no stable identifier — the old application keyed on
 * the display label and warned when two collided. A slug plus a counter is the
 * same information without the ambiguity, and it survives a URL.
 */
const idsFor = (terms: readonly { readonly englishTerm: string }[]): readonly string[] => {
  const used = new Map<string, number>();
  return terms.map((term) => {
    const base = term.englishTerm.toLowerCase().replace(SLUG, "-").replace(/^-|-$/g, "");
    const stem = base === "" ? "term" : base;
    const seen = used.get(stem) ?? 0;
    used.set(stem, seen + 1);
    return seen === 0 ? stem : `${stem}-${seen + 1}`;
  });
};

/**
 * The envelope, joined into terms.
 *
 * One pass: every referenced sid is normalized and deduped, the curated set is
 * marked, and each occurrence carries the reading and the highlight ranges the
 * generator computed for it. Occurrences come out in canonical document order
 * of the guide's own listing — the exhaustive list is already in that order,
 * and a curated verse the exhaustive list omits is appended in the order it
 * was curated.
 *
 * Nothing is thrown for a bad reference: an unparseable sid is one occurrence
 * the guide does not get, which is what the old application's warnings said in
 * more words.
 */
const termsOf = (envelope: StetEnvelope): readonly Term[] => {
  const ids = idsFor(envelope.terms);
  return envelope.terms.map((term, index) => {
    const curated = new Set<string>();
    const order: ParsedSid[] = [];
    const seen = new Set<string>();

    const push = (raw: string): ParsedSid | undefined => {
      const parsed = parseSid(raw);
      if (parsed === undefined) return undefined;
      if (!seen.has(parsed.sid)) {
        seen.add(parsed.sid);
        order.push(parsed);
      }
      return parsed;
    };

    for (const entry of term.subsetVerses) {
      const parsed = push(entry.ref);
      if (parsed !== undefined) curated.add(parsed.sid);
    }
    for (const raw of term.exhaustiveVerses) push(raw);

    const occurrences: TermOccurrence[] = order.map((parsed) => {
      const text = envelope.referenceVerses[parsed.sid];
      const ranges = term.glossRanges[parsed.sid];
      const spans =
        text === undefined || ranges === undefined
          ? undefined
          : ranges
              .map(([from, to]) => ({ from, to }))
              .filter((span) => span.from >= 0 && span.to <= text.length && span.from < span.to);
      return {
        book: parsed.book,
        chapter: parsed.chapter,
        verse: parsed.verse,
        sid: parsed.sid,
        curated: curated.has(parsed.sid),
        ...(text === undefined ? {} : { sourceText: text }),
        ...(spans === undefined || spans.length === 0 ? {} : { spans }),
      };
    });

    return {
      // SAFETY: `ids` is built from `envelope.terms` and indexed in step.
      id: ids[index] ?? term.englishTerm,
      term: term.term,
      englishTerm: term.englishTerm,
      glosses: term.glosses,
      definition: term.definition,
      ...(term.strongs.length === 0 ? {} : { strongs: term.strongs }),
      occurrences,
      done: 0,
    };
  });
};

/** One guide, decoded from whatever read its bytes. */
export const decodeGuide = (
  locale: string,
  value: unknown,
): Effect.Effect<readonly Term[], StetError> => {
  const decoded = decodeEnvelope(value);
  if (Result.isFailure(decoded))
    return Effect.fail(new StetError({ locale, reason: decoded.failure.message }));
  const envelope = decoded.success;
  // The manifest's locale is the cache key; an envelope that disagrees with it
  // is a mismatched file, and keying it would serve Spanish as English.
  if (envelope.locale !== locale)
    return Effect.fail(
      new StetError({ locale, reason: `envelope declares locale ${envelope.locale}` }),
    );
  return Effect.succeed(termsOf(envelope));
};

/** The guide manifest, decoded. */
export const decodeManifestGuides = (
  value: unknown,
): Effect.Effect<readonly Guide[], StetError> => {
  const decoded = decodeManifest(value);
  if (Result.isFailure(decoded))
    return Effect.fail(new StetError({ locale: "*", reason: decoded.failure.message }));
  return Effect.succeed(
    decoded.success.guides.map((guide) => ({
      locale: guide.locale,
      displayName: guide.displayName,
      provenanceId: guide.provenanceId,
    })),
  );
};
