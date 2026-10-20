import type { Book, BookId } from "@sefer/text/book";
import { tocViewOf } from "@sefer/text/engine/location";
import { bookName } from "@sefer/text/location/canon";
import type { SourceStamp } from "@sefer/text/source";
import { Context, Duration, Effect, Latch, Layer, Option, PubSub, Scope, Stream } from "effect";

import {
  corpusReader,
  fromAnalysis,
  type CorpusReader,
  type Finding,
  type PublishedBook,
} from "../findings/finding";
import { EMPTY as EMPTY_INVENTORY, inventory, type Inventory } from "../findings/inventory";
import { NO_SUPPRESSIONS, versesOf, type Suppressions } from "../findings/suppressions";
import {
  describesExactly,
  Galley,
  stampOf,
  type Analysis,
  type FindingsSnapshot,
  type GalleyService,
} from "../galley";
import { Observability, type ObservabilityService } from "../observability";
import type { Project } from "../project/project";

const QUIET = 150;

const DEADLINE = 1_000;

export interface BookSummary {
  readonly bookId: BookId;
  readonly path: string;
  readonly stamp: SourceStamp;
  readonly chapters: number;
  readonly verses: number;
  readonly diagnostics: { readonly errors: number; readonly warnings: number };
}

export interface HeldAnalysis {
  readonly analysis: Analysis;
  readonly stamp: SourceStamp;
}

export interface ReferenceText {
  readonly id: string;
  readonly text: string;
}

export interface ProjectAnalysisService {
  readonly attach: (
    project: Project,
    options?: { readonly first?: BookId },
  ) => Effect.Effect<void, never, Scope.Scope>;

  readonly supply: (bookId: BookId, analysis: Analysis, cause?: string) => void;

  readonly attachReferences: (
    references: readonly ReferenceText[],
  ) => Effect.Effect<readonly string[]>;

  readonly references: () => readonly string[];

  readonly referenceText: (id: string) => string | undefined;

  readonly census: (project: Project) => readonly BookSummary[];

  readonly analysis: (bookId: BookId) => Option.Option<HeldAnalysis>;
  readonly fresh: (bookId: BookId, stamp: SourceStamp) => boolean;
  readonly invalidate: (bookId: BookId) => void;

  readonly rejudge: () => void;

  readonly findings: () => readonly Finding[];

  readonly crossBook: () => readonly Finding[];

  readonly crossBookOf: (bookId: BookId) => readonly Finding[];

  readonly findingTotals: () => { readonly errors: number; readonly warnings: number };

  readonly setSuppressions: (suppressions: Suppressions) => void;

  readonly suppressed: () => readonly Finding[];

  readonly onSuppressions: (listener: () => void) => () => void;

  readonly versesIn: (bookId: BookId) => ReadonlyMap<string, readonly string[]> | undefined;

  readonly inventory: () => Inventory;

  readonly watch: () => Stream.Stream<{ readonly bookId: BookId; readonly stamp: SourceStamp }>;
}

export class ProjectAnalysis extends Context.Service<ProjectAnalysis, ProjectAnalysisService>()(
  "ProjectAnalysis",
) {}

interface Entry {
  analysis: Analysis | undefined;
  stamp: SourceStamp | undefined;
  path: string;
  stale: boolean;
}

const versesIn = (rows: {
  length: number;
  seek: (index: number) => { first: number; last: number };
}): number => {
  let verses = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const { first, last } = rows.seek(index);
    verses += last >= first && first > 0 ? last - first + 1 : 1;
  }
  return verses;
};

const chaptersIn = (analysis: Analysis): number =>
  Math.max(0, analysis.dish.toc.chapterRows.length - 1);

const countsOf = (
  bookId: BookId,
  analysis: Analysis,
  stamp: SourceStamp,
): { readonly errors: number; readonly warnings: number } => {
  let errors = 0;
  let warnings = 0;
  for (const finding of fromAnalysis(bookId, analysis, stamp)) {
    if (finding.severity === "error") errors += 1;
    else if (finding.severity === "warning") warnings += 1;
  }
  return { errors, warnings };
};

export const censusOf = (
  bookId: BookId,
  analysis: Analysis,
): Pick<BookSummary, "chapters" | "verses" | "diagnostics"> => ({
  chapters: chaptersIn(analysis),
  verses: versesIn(analysis.dish.toc.verseRows),
  diagnostics: countsOf(bookId, analysis, { revision: 0, length: 0 }),
});

const summaryOf = (bookId: BookId, entry: Entry): BookSummary => {
  const analysis = entry.analysis;
  if (analysis === undefined || entry.stamp === undefined)
    return {
      bookId,
      path: entry.path,
      stamp: { revision: 0, length: 0 },
      chapters: 0,
      verses: 0,
      diagnostics: { errors: 0, warnings: 0 },
    };
  const { toc } = analysis.dish;
  return {
    bookId,
    path: entry.path,
    stamp: entry.stamp,
    chapters: chaptersIn(analysis),
    verses: versesIn(toc.verseRows),
    diagnostics: countsOf(bookId, analysis, entry.stamp),
  };
};

const make = (
  galley: GalleyService,
  observability: ObservabilityService | undefined,
): Effect.Effect<ProjectAnalysisService> =>
  Effect.gen(function* () {
    const entries = new Map<BookId, Entry>();
    const supplied = new Map<BookId, Analysis>();
    const pending = new Set<BookId>();
    let referenceIds: readonly string[] = [];

    const referenceTexts = new Map<string, string>();
    let attached: Project | undefined;
    let snapshot: FindingsSnapshot | undefined;
    let findingsCache: readonly Finding[] | undefined;
    let corpusCache: CorpusReader | undefined;
    let totalsCache: { readonly errors: number; readonly warnings: number } | undefined;
    let inventoryCache: Inventory | undefined;
    let suppressions: Suppressions = NO_SUPPRESSIONS;
    const suppressionListeners = new Set<() => void>();

    const pubsub = yield* PubSub.unbounded<{
      readonly bookId: BookId;
      readonly stamp: SourceStamp;
    }>();
    const latch = Latch.makeUnsafe(false);
    let lastArmed = 0;
    let burstStarted = 0;
    let armed = false;
    let causedBy: string | undefined;

    const invalidateCaches = (): void => {
      findingsCache = undefined;
      corpusCache = undefined;
      totalsCache = undefined;
      inventoryCache = undefined;
    };

    const arm = (bookId: BookId): void => {
      pending.add(bookId);
      const now = Date.now();
      lastArmed = now;
      if (!armed) {
        armed = true;
        burstStarted = now;
      }
      latch.openUnsafe();
    };

    const refresh = (
      bookId: BookId,
      book: Book,
      entry: Entry,
      into: ObservabilityService | undefined = observability,
    ): SourceStamp | undefined => {
      const source = book.source();
      const handed = supplied.get(bookId);
      supplied.delete(bookId);
      let analysis: Analysis;
      if (handed !== undefined && describesExactly(handed, source.text)) analysis = handed;
      else {
        try {
          analysis = galley.analyze(source.text, "scheduler", bookId, into);
        } catch {
          into?.note("book.analyze", "failed", "engine refused", { "book.id": bookId });
          return undefined;
        }
      }
      entry.analysis = analysis;
      entry.stamp = source.stamp;
      entry.stale = false;
      const { errors } = countsOf(bookId, analysis, source.stamp);
      into?.note("book.analyze", "ready", undefined, {
        "book.id": bookId,
        "analysis.diagnostics": analysis.dish.diagnostics.length,
        "analysis.errors": errors,
      });
      return source.stamp;
    };

    const forget = (id: string): void => {
      try {
        galley.remove(id);
      } catch {}
    };

    const publishCorpus = (into: ObservabilityService | undefined = observability): void => {
      const done = into?.span("corpus.publish");
      try {
        snapshot = galley.publish();
      } catch (cause) {
        into?.note("corpus.publish", "failed", String(cause));
      }
      done?.();
    };

    const pass = Effect.sync(() => {
      const project = attached;
      if (project === undefined) {
        pending.clear();
        return;
      }
      const todo = [...pending];
      pending.clear();
      const running = observability?.operation(
        "analysis.pass",
        { "analysis.books": todo.length },
        causedBy === undefined ? undefined : { cause: causedBy },
      );
      causedBy = undefined;
      const refreshed: { bookId: BookId; stamp: SourceStamp }[] = [];
      for (const bookId of todo) {
        const entry = entries.get(bookId);
        const book = project.book(bookId);
        if (entry === undefined || book === undefined) continue;
        const stamp = refresh(bookId, book, entry, running ?? observability);
        if (stamp !== undefined) refreshed.push({ bookId, stamp });
      }
      if (refreshed.length > 0) {
        publishCorpus();
        invalidateCaches();
      }
      running?.end("ready", { "analysis.refreshed": refreshed.length });
      return refreshed;
    });

    const resolveBook = (id: string): PublishedBook | undefined => {
      const entry = entries.get(id);
      if (entry === undefined || entry.analysis === undefined || entry.stamp === undefined)
        return undefined;
      const analysis = entry.analysis;
      const metadata =
        attached === undefined ? undefined : Option.getOrUndefined(attached.metadata());
      return {
        bookId: id,
        stamp: entry.stamp,
        engine: stampOf(analysis),
        text: analysis.text,
        name: bookName(id, metadata),
        mask: () => galley.mask(id),
        toc: () => tocViewOf(analysis),
      };
    };

    const corpus = (): CorpusReader | undefined => {
      if (snapshot === undefined) return undefined;
      corpusCache ??= corpusReader(snapshot, resolveBook, suppressions);
      return corpusCache;
    };
    const crossBook = (): readonly Finding[] => corpus()?.all() ?? [];
    const crossBookOf = (bookId: BookId): readonly Finding[] => corpus()?.of(bookId) ?? [];

    const findingTotals = (): { readonly errors: number; readonly warnings: number } => {
      if (totalsCache !== undefined) return totalsCache;
      let errors = 0;
      let warnings = 0;
      for (const [bookId, entry] of entries) {
        if (entry.analysis === undefined || entry.stamp === undefined) continue;
        for (const finding of fromAnalysis(bookId, entry.analysis, entry.stamp))
          if (finding.severity === "error") errors += 1;
          else if (finding.severity === "warning") warnings += 1;
      }
      const shared = corpus()?.totals();
      totalsCache = {
        errors: errors + (shared?.errors ?? 0),
        warnings: warnings + (shared?.warnings ?? 0),
      };
      return totalsCache;
    };

    const setSuppressions = (next: Suppressions): void => {
      suppressions = next;
      findingsCache = undefined;
      corpusCache = undefined;
      totalsCache = undefined;
      for (const listener of suppressionListeners) listener();
    };
    const onSuppressions = (listener: () => void): (() => void) => {
      suppressionListeners.add(listener);
      return () => suppressionListeners.delete(listener);
    };
    const suppressed = (): readonly Finding[] => corpus()?.suppressed() ?? [];
    const versesIn = (bookId: BookId): ReadonlyMap<string, readonly string[]> | undefined => {
      const analysis = entries.get(bookId)?.analysis;
      return analysis === undefined
        ? undefined
        : versesOf(bookId, analysis.text, tocViewOf(analysis));
    };

    const characters = (): Inventory => {
      if (inventoryCache !== undefined) return inventoryCache;
      inventoryCache = snapshot === undefined ? EMPTY_INVENTORY : inventory(snapshot, resolveBook);
      return inventoryCache;
    };

    const findings = (): readonly Finding[] => {
      if (findingsCache !== undefined) return findingsCache;
      const out: Finding[] = [];
      for (const [bookId, entry] of entries) {
        if (entry.analysis === undefined || entry.stamp === undefined) continue;
        out.push(...fromAnalysis(bookId, entry.analysis, entry.stamp));
      }
      out.push(...crossBook());
      findingsCache = out;
      return out;
    };

    const attach = (
      project: Project,
      options?: { readonly first?: BookId },
    ): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const into = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
        for (const bookId of entries.keys()) forget(bookId);
        for (const id of referenceIds) forget(id);
        referenceIds = [];
        entries.clear();
        supplied.clear();
        pending.clear();
        snapshot = undefined;
        invalidateCaches();
        attached = project;

        const unsubscribes = new Map<BookId, () => void>();
        const subscribe = (book: Book): void => {
          unsubscribes.get(book.id)?.();
          unsubscribes.set(
            book.id,
            book.changes(() => {
              const entry = entries.get(book.id);
              if (entry !== undefined) entry.stale = true;
              invalidateCaches();
              arm(book.id);
            }),
          );
        };

        const done = into?.span("analysis.pass", project.root);
        let slowest: BookId | undefined;
        let slowestMs = 0;
        const first = options?.first;
        const ordered =
          first === undefined
            ? project.books
            : [...project.books].sort((a, b) => Number(b.id === first) - Number(a.id === first));
        for (const book of ordered) {
          const entry: Entry = {
            analysis: undefined,
            stamp: undefined,
            path: book.path,
            stale: true,
          };
          entries.set(book.id, entry);
          // Serial, on this thread, one book at a time, and every book fully
          // parsed before the project opens. Measured on en_ulb (66 books,
          // 4.4MB): 85ms, against 65ms for registering now and warming the
          // syntax trees on idle afterwards. Twenty milliseconds is not worth
          // three mechanisms and a reader watching badges populate, so the
          // whole project is warm from the first frame.
          // One book's own cost, kept as a number rather than a record. Sixty-
          // six `galley.parse` spans answer "is ONE book pathological", which
          // is worth asking and not worth 132 records in a bounded ring every
          // time a project opens — so the spans are there at level `all` and
          // the outlier is always on the span below.
          const started = performance.now();
          refresh(book.id, book, entry, into);
          const took = performance.now() - started;
          if (took > slowestMs) {
            slowestMs = took;
            slowest = book.id;
          }
          subscribe(book);
        }
        done?.({
          "analysis.books": entries.size,
          ...(slowest === undefined
            ? {}
            : {
                "analysis.slowest": slowest,
                "analysis.slowest_ms": Math.round(slowestMs * 10) / 10,
              }),
        });

        // The first publication is AWAITED, not forked, and it is the expensive
        // half of a cold open — every chapter of every book mapped, the corpus
        // judged, ~410ms for a Bible.
        //
        // Forking it never made it concurrent. It is a synchronous wasm call on
        // the one thread, so a fork only moved the stall to AFTER first paint,
        // where it landed on the reader's first scroll or click. Inline, it
        // lands where a reader is already waiting, and "the project is open"
        // means the project is parsed, registered AND proofread — no findings
        // arriving late, nothing populating in.
        publishCorpus(into);
        invalidateCaches();

        const unwatchProject = project.changed((bookId) => {
          const book = project.book(bookId);
          if (book === undefined) return;
          subscribe(book);
          const entry = entries.get(bookId);
          if (entry !== undefined) entry.stale = true;
          invalidateCaches();
          arm(bookId);
        });

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            unwatchProject();
            for (const off of unsubscribes.values()) off();
            unsubscribes.clear();
            if (attached === project) attached = undefined;
          }),
        );

        const loop = Effect.forever(
          Effect.gen(function* () {
            yield* latch.await;
            for (;;) {
              const now = Date.now();
              const untilQuiet = QUIET - (now - lastArmed);
              const untilDeadline = DEADLINE - (now - burstStarted);
              const wait = Math.min(untilQuiet, untilDeadline);
              if (wait <= 0) break;
              yield* Effect.sleep(Duration.millis(wait));
            }
            armed = false;
            latch.closeUnsafe();
            const refreshed = yield* pass;
            for (const event of refreshed ?? []) yield* PubSub.publish(pubsub, event);
          }),
        );
        yield* Effect.forkScoped(loop);
      });

    const attachReferences = (
      references: readonly ReferenceText[],
    ): Effect.Effect<readonly string[]> =>
      Effect.sync(() => {
        const wanted = new Set(references.map((reference) => reference.id));
        for (const id of referenceIds)
          if (!wanted.has(id)) {
            forget(id);
            referenceTexts.delete(id);
          }
        const registered: string[] = [];
        for (const reference of references) {
          try {
            galley.updateReference(reference.id, reference.text, true);
            referenceTexts.set(reference.id, reference.text);
            registered.push(reference.id);
          } catch (cause) {
            observability?.note("corpus.reference", "failed", `${reference.id} ${String(cause)}`);
          }
        }
        referenceIds = registered;
        observability?.note("corpus.reference", "ready", `${registered.length} books`);
        return registered;
      });

    return {
      attach,
      attachReferences,
      references: () => referenceIds,
      referenceText: (id) => referenceTexts.get(id),
      supply: (bookId, analysis, cause) => {
        supplied.set(bookId, analysis);
        if (cause !== undefined) causedBy = cause;
        arm(bookId);
      },
      census: (project) =>
        project.books.map((book) => {
          const entry = entries.get(book.id);
          return entry === undefined
            ? summaryOf(book.id, {
                analysis: undefined,
                stamp: undefined,
                path: book.path,
                stale: true,
              })
            : summaryOf(book.id, entry);
        }),
      analysis: (bookId) => {
        const entry = entries.get(bookId);
        if (entry === undefined || entry.analysis === undefined || entry.stamp === undefined)
          return Option.none();
        return Option.some({ analysis: entry.analysis, stamp: entry.stamp });
      },
      fresh: (bookId, stamp) => {
        const entry = entries.get(bookId);
        return (
          entry !== undefined &&
          !entry.stale &&
          entry.stamp !== undefined &&
          entry.stamp.revision === stamp.revision
        );
      },
      invalidate: (bookId) => {
        const entry = entries.get(bookId);
        if (entry !== undefined) entry.stale = true;
        invalidateCaches();
        arm(bookId);
      },
      rejudge: () => {
        invalidateCaches();
        for (const [bookId, entry] of entries) {
          entry.stale = true;
          arm(bookId);
        }
      },
      findings,
      crossBook,
      crossBookOf,
      findingTotals,
      setSuppressions,
      suppressed,
      onSuppressions,
      versesIn,
      inventory: characters,
      watch: () => Stream.fromPubSub(pubsub),
    };
  });

export const ProjectAnalysisLive: Layer.Layer<ProjectAnalysis, never, Galley> = Layer.effect(
  ProjectAnalysis,
  Effect.gen(function* () {
    const galley = yield* Galley;
    const observability = yield* Effect.serviceOption(Observability);
    return yield* make(galley, Option.getOrUndefined(observability));
  }),
);
