/**
 * STET (slice 27): formatting transfer, and comparison against a reference.
 *
 * "STET" is the proofreader's mark meaning "let it stand". The job it names
 * here is the reverse of drafting: the text is already right, and what must be
 * carried across is the FORMATTING — paragraph breaks, poetry indentation,
 * section headings — from a source book to a target that has the same words
 * arranged as one undifferentiated run.
 *
 * ## It is the ENGINE's, and that is the whole point
 *
 * This was a stub, and the note on it said the alignment rules were the domain
 * owner's and this file must not invent them. It still must not, and it no
 * longer has to: scripture-kitchen v0.1.0 carries the overlay doors
 * (`galley/src/overlay.md`, engine-asks item 3), so "which markers transfer,
 * what happens at a verse the target has split or merged, and how a mismatch is
 * reported" are answered by the same engine that parses the text.
 *
 * What is left for a workflow is the join: register both sides with the handle,
 * ask for both skeletons and the transaction, and hand them back. The rules
 * live upstream; the decisions — whether to apply, and to which chapters —
 * belong to the person reading the two columns.
 *
 * `stetCompare` is the read-only half: the same alignment, reported as a
 * Comparison the reviewer reads side by side against a Library resource, with
 * no edits offered. Still a stub.
 */

import { Effect, Option } from "effect";

import type { Ref } from "../../core/book/book";
import type {
  GalleyService,
  OverlayEdits,
  OverlayOptions,
  Skeleton,
  SkeletonRow,
} from "../../core/galley";
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

/** One side of a match-formatting view: a registered id and the text behind it. */
export interface OverlaySide {
  /** The id the engine knows it by — a `BookId` for the target, a path for a source. */
  readonly id: string;
  readonly text: string;
}

/** Both skeletons plus the transaction, which is everything the view draws. */
export interface MatchFormatting {
  readonly target: Skeleton;
  readonly source: Skeleton;
  readonly overlay: OverlayEdits;
}

/**
 * Register both sides with the wasm handle, so the overlay doors can read them.
 *
 * The handle directly — which, since the `CorpusEngine` port was deleted, is
 * the only door. What is worth
 * reading twice here. The overlay doors are on the `Galley` handle in this
 * process; on Web the corpus IS that handle, so the target is already there and
 * this costs a checksum, but on desktop the corpus lives in the native process
 * and the wasm handle has never been told about either book. Registering here
 * makes the view work identically on both hosts, at the price of the source's
 * text being resident twice on desktop. That is the right trade for a view a
 * translator opens deliberately and closes again.
 *
 * `keepText: true` on the source: an overlay reads its blocks, and a reference
 * registered without its text retains verse lengths and nothing else.
 */
const register = (galley: GalleyService, target: OverlaySide, source: OverlaySide): void => {
  galley.update(target.id, target.text);
  galley.updateReference(source.id, source.text, true);
};

/**
 * Match formatting: the source's block structure, the target's, and the edits
 * that would make the second the first.
 *
 * Both skeletons come back because that is how the live highlight is drawn —
 * fetch them once per edit (~0.4 ms each) and match ADDRESSES in TypeScript as
 * the reader moves through the target. `targetNodeFor`/`sourceNodeFor` are for
 * one-off questions and are an order of magnitude dearer; a per-cursor-move
 * call into wasm is not what they are for.
 *
 * The overlay is a SUGGESTION. Nothing here writes: `overlay.edits` is a
 * transaction the caller applies through `book.apply` after showing
 * `overlay.report`, so the whole thing is one revision and one Undo step.
 *
 * Synchronous, like `analyze`: these are wasm calls on the handle Sefer already
 * holds, and an Effect per keystroke of a highlight is a budget this does not
 * have.
 */
export const matchFormatting = (
  galley: GalleyService,
  target: OverlaySide,
  source: OverlaySide,
  opts?: OverlayOptions,
): MatchFormatting => {
  register(galley, target, source);
  return {
    target: galley.skeleton(target.id, opts),
    source: galley.skeleton(source.id, opts),
    overlay: galley.overlay(target.id, source.id, opts),
  };
};

/**
 * The source block that answers a target block's address, or `undefined`.
 *
 * The address is `(sid, where, ordinal)` and the MARKER IS NOT PART OF IT —
 * matching on the marker too would mean a `\q1` in the source and a `\q2` in
 * the target never pair, which is exactly the difference a translator opened
 * this view to see.
 */
export const equivalentBlock = (
  skeleton: Skeleton,
  address: { readonly sid: string; readonly where: string; readonly ordinal: number },
): SkeletonRow | undefined =>
  skeleton.blocks.find(
    (row) =>
      row.sid === address.sid && row.where === address.where && row.ordinal === address.ordinal,
  );

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
