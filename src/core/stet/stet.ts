import type { BookId } from "@sefer/text/book";
import { versesAddress, type Address } from "@sefer/text/location/address";
import { Context, Data, Effect, Option, Result, Schema } from "effect";

const Range = Schema.Tuple([Schema.Number, Schema.Number]);

const EnvelopeTerm = Schema.Struct({
  term: Schema.String,
  englishTerm: Schema.String,
  strongs: Schema.Array(Schema.Number),
  definition: Schema.String,
  subsetVerses: Schema.Array(
    Schema.Struct({
      ref: Schema.String,
      sameTranslationGroup: Schema.optionalKey(Schema.String),
    }),
  ),
  exhaustiveVerses: Schema.Array(Schema.String),
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
  referenceVerses: Schema.Record(Schema.String, Schema.String),
  terms: Schema.Array(EnvelopeTerm),
});

type StetEnvelope = typeof StetEnvelope.Type;

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

export interface Guide {
  readonly locale: string;
  readonly displayName: string;
  readonly provenanceId: string;
  readonly sourceUrl?: string;
}

export interface Span {
  readonly from: number;
  readonly to: number;
}

export interface TermOccurrence {
  readonly address: Address;
  readonly sid: string;
  readonly sourceText?: string;
  readonly spans?: readonly Span[];
  readonly curated: boolean;
}

export interface Term {
  readonly id: string;
  readonly term: string;
  readonly englishTerm: string;
  readonly glosses: readonly string[];
  readonly definition: string;
  readonly strongs?: readonly number[];
  readonly occurrences: readonly TermOccurrence[];
  readonly done: number;
}

export class StetError extends Data.TaggedError("StetError")<{
  readonly locale: string;
  readonly reason: string;
}> {}

interface StetCatalogService {
  readonly guides: () => Effect.Effect<readonly Guide[], StetError>;
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

const decodeEnvelope = Schema.decodeUnknownResult(StetEnvelope);
const decodeManifest = Schema.decodeUnknownResult(StetManifest);

const SID = /^([A-Z0-9]{3})[ \t]+(\d+):(\d+)$/;

interface ParsedSid {
  readonly book: BookId;
  readonly chapter: number;
  readonly verse: number;
  readonly sid: string;
}

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
        address: versesAddress(parsed.book, { chapter: parsed.chapter, verse: parsed.verse }),
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

export const decodeGuide = (
  locale: string,
  value: unknown,
): Effect.Effect<readonly Term[], StetError> => {
  const decoded = decodeEnvelope(value);
  if (Result.isFailure(decoded))
    return Effect.fail(new StetError({ locale, reason: decoded.failure.message }));
  const envelope = decoded.success;
  if (envelope.locale !== locale)
    return Effect.fail(
      new StetError({ locale, reason: `envelope declares locale ${envelope.locale}` }),
    );
  return Effect.succeed(termsOf(envelope));
};

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
