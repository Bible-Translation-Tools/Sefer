// projectAnalysis.ts
//
// ProjectAnalysis — Sefer's whole-project consumer of Galley ("global truth,
// local rendering"). See `documentation/architecture/findings.md` and
// `documentation/architecture/galley.md`.
//
// It exists to answer one question the editor cannot: does this PROJECT have
// errors? A translator must not have to open sixty-six files to find out. So
// this is the only module that holds many books' analyses at once, and it
// holds them as stamped, disposable products: a publish on a book marks its
// entry stale, and re-analysis happens off the keystroke path.
//
// Three decisions shape the whole file.
//
//  1. ONE scheduling fiber, not one per book. A single fiber over a pending
//     set of book ids gives the same ~150 ms quiet window as a debounced
//     fiber per book with less machinery, and coalesces a bulk
//     operation that touches forty books into one pass and ONE corpus
//     publication — which is what "bulk operations coalesce" has to mean,
//     because `publish()` is whole-corpus and a snapshot replaces the previous
//     one entirely.
//
//  2. The instantiated book is not analyzed twice. The editor already analyzes
//     synchronously on every keystroke, so it hands its current `Analysis` in
//     through `supply(bookId, analysis)`; the scheduler then only owes that
//     book its corpus update. Composition wires `supply` from the editor
//     layer — core cannot reach into CodeMirror.
//
//  3. Failure retains, never clears. `analyze` throws on text the engine
//     refuses; the held analysis stays and the entry stays stale, so the panel
//     shows known-stale findings rather than an apparently clean project.
//
// ONE engine. The per-book `analyze` and the whole-corpus `update`/`remove`/
// `publish` are two halves of the same `Galley` handle in this process, and
// every call here is SYNCHRONOUS. That is load-bearing, not incidental:
// JavaScript cannot run a keystroke handler in the middle of a wasm call, so a
// debounced publication needs its revision checked once on entry and never
// again — nothing can move underneath it. Why the corpus half is not a port
// with a native implementation is in documentation/architecture/galley.md.
//
// Telemetry carries counts and codes only. A diagnostic's message quotes the
// document and lives in Findings.

import { Context, Duration, Effect, Latch, Layer, Option, PubSub, Scope, Stream } from "effect";

import type { Book, BookId } from "../book/book";
import { fromAnalysis, fromSnapshot, type Finding } from "../findings/finding";
import { EMPTY as EMPTY_INVENTORY, inventory, type Inventory } from "../findings/inventory";
import {
  describesExactly,
  Galley,
  stampOf,
  type Analysis,
  type EngineStamp,
  type FindingsSnapshot,
  type GalleyService,
} from "../galley";
import { Observability, type ObservabilityService } from "../observability";
import type { Project } from "../project/project";
import type { SourceStamp } from "../source/source";

/**
 * Quiet window before a changed book is re-analyzed. Long enough that typing
 * in an unfocused-but-subscribed book does not queue a parse per keystroke,
 * short enough that the panel feels attached to the document.
 */
const QUIET = 150;

/** Upper bound from the first arming of a burst, so a long paste-and-type
 * session still refreshes the panel instead of waiting for silence. */
const DEADLINE = 1_000;

/** One book's row in the census. Counts come from the held analysis. */
export interface BookSummary {
  readonly bookId: BookId;
  readonly path: string;
  readonly stamp: SourceStamp;
  readonly chapters: number;
  readonly verses: number;
  readonly diagnostics: { readonly errors: number; readonly warnings: number };
}

/** What `analysis(bookId)` hands back: the parse, and the text it describes. */
export interface HeldAnalysis {
  readonly analysis: Analysis;
  readonly stamp: SourceStamp;
}

/**
 * One book of a Library-bound source or reference resource, as text.
 *
 * The TEXT, not a path: this module reads no files. Whoever resolved the
 * binding did the reading — `src/app/workflows/references.ts` — because the
 * Library and the FileSystem are the shell's to reach and a core module that
 * required both would make every composition of ProjectAnalysis carry them.
 */
export interface ReferenceText {
  /** The caller's own id, unique across the project. The resource path serves. */
  readonly id: string;
  readonly text: string;
}

export interface ProjectAnalysisService {
  /**
   * Subscribe to a Project: analyze every book once, register the corpus, and
   * keep both in step as books change. Requires `Scope` because it forks the
   * scheduling fiber and holds subscriptions; closing the scope drops both.
   *
   * Analyzing every book here is deliberate and is the point of the module.
   * It is a project-open cost, not an interaction cost.
   *
   * Attaching a second Project replaces the first: the module holds one
   * project's worth of analyses, and the Galley corpus is one corpus.
   */
  readonly attach: (
    project: Project,
    options?: { readonly first?: BookId },
  ) => Effect.Effect<void, never, Scope.Scope>;

  /**
   * The editor's own synchronous analysis, handed in instead of a second
   * parse. Safe to call from a `book.changes` callback: it writes two maps and
   * opens a latch. The book's corpus registration is refreshed on the next
   * scheduler pass, so a keystroke costs no wasm call beyond the editor's own.
   */
  /**
   * `cause` is the trace of the gesture that produced this Analysis. The pass
   * it arms is debounced and serves several gestures, so it cannot be a child
   * of one — it carries `op.cause` instead, and one query returns the cascade.
   */
  readonly supply: (bookId: BookId, analysis: Analysis, cause?: string) => void;

  /**
   * Register the project's bound source and reference books WITH THEIR TEXT,
   * so Find's "Reference" scope and the overlay doors have something to read.
   *
   * Separate from `attach` on purpose. A reference is a Library binding, and
   * the Library and the FileSystem are the shell's services: making this
   * module require them would put two host-facing Layers behind every
   * composition of it, for a feature two screens use. So the shell resolves
   * the binding and hands the text in, exactly as the editor hands its
   * analysis in through `supply`.
   *
   * REPLACES the set: a reference registered by a previous call and absent
   * from this one is dropped from the corpus, because a binding the project no
   * longer has must not keep answering searches. Succeeds with the ids that
   * are now registered — a caller uses it to decide whether to offer the scope
   * at all.
   *
   * Idempotent per id: the same text costs a checksum, so a screen may call
   * this every time it opens.
   */
  readonly attachReferences: (
    references: readonly ReferenceText[],
  ) => Effect.Effect<readonly string[]>;

  /** The reference ids currently registered, in the order they were given. */
  readonly references: () => readonly string[];

  /**
   * One registered reference's canonical text, or `undefined` for an id this
   * never registered.
   *
   * The engine holds its own copy and will not give it back as addressable
   * source — `verseText(id)` answers the PROJECTION — so a caller that has to
   * turn a reference hit into a chapter and verse reads it here.
   */
  readonly referenceText: (id: string) => string | undefined;

  /**
   * The project census, from the analyses currently held. Synchronous: every
   * input is already in memory, and a census that could suspend would be a
   * census the shell has to await on every render.
   *
   * A book with no held analysis yet (or one whose analysis failed) reports
   * zero chapters, zero verses and zero counts — read `fresh` to tell that
   * apart from a clean book.
   */
  readonly census: (project: Project) => readonly BookSummary[];

  readonly analysis: (bookId: BookId) => Option.Option<HeldAnalysis>;
  /** Is the held analysis the one for this stamp? */
  readonly fresh: (bookId: BookId, stamp: SourceStamp) => boolean;
  /** Mark a book's analysis stale and schedule a re-analysis. */
  readonly invalidate: (bookId: BookId) => void;

  /**
   * Every finding in the project, in one shape: per-book Galley diagnostics
   * from the held analyses, plus the Sous findings of the last publication.
   * Memoised until something changes, because a panel asks on every render.
   */
  readonly findings: () => readonly Finding[];

  /** Just the corpus-level half — the findings no single book could produce. */
  readonly crossBook: () => readonly Finding[];

  /**
   * The last publication's pattern table, pivoted per character — what the
   * corpus does with its punctuation, and which sites were flagged.
   *
   * Memoised beside `findings()` and recomputed only when a publication lands,
   * so it is off the keystroke path by construction: nothing recomputes it
   * until the same event that replaces the snapshot. Empty until the first
   * publication. The pattern indices inside it are indices into THAT snapshot
   * and are never valid against another one.
   */
  readonly inventory: () => Inventory;

  /** Republishes `{ bookId, stamp }` after each re-analysis. */
  readonly watch: () => Stream.Stream<{ readonly bookId: BookId; readonly stamp: SourceStamp }>;
}

export class ProjectAnalysis extends Context.Service<ProjectAnalysis, ProjectAnalysisService>()(
  "ProjectAnalysis",
) {}

interface Entry {
  /** The last analysis we hold, fresh or not. Retained through failures. */
  analysis: Analysis | undefined;
  /** The Book stamp `analysis` describes. */
  stamp: SourceStamp | undefined;
  path: string;
  /** True when the text moved and the analysis has not caught up. */
  stale: boolean;
}

/**
 * A bridged anchor (`\v 5-7`) names three verses from one row, so a verse count
 * is over verse NUMBERS, not over rows. `first === 0` is the engine's mark for
 * a missing or malformed designator; it still occupies one anchor.
 *
 * Stated here rather than inline because the TOC reader (`toc(id)`) answers the
 * same question with two getters that do NOT mean this — `verseCount` counts
 * `\v` markers, and `chapters` drops the synthetic front-matter row that
 * `chapterRows.length` includes — so anyone reaching for those needs this walk.
 */
const versesIn = (rows: {
  length: number;
  seek: (n: number) => { first: number; last: number };
}): number => {
  let verses = 0;
  for (let n = 0; n < rows.length; n += 1) {
    const { first, last } = rows.seek(n);
    verses += last >= first && first > 0 ? last - first + 1 : 1;
  }
  return verses;
};

/** The two rungs the census reports, counted once over the one shape. */
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
    chapters: toc.chapterRows.length,
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
    /** Analyses handed in by the editor, keyed by book; consumed by the pass. */
    const supplied = new Map<BookId, Analysis>();
    const pending = new Set<BookId>();
    /** Bound source/reference books registered with their text, in order. */
    let referenceIds: readonly string[] = [];

    /**
     * The canonical text of every registered reference, by id.
     *
     * Held because the ENGINE's copy cannot be read back as text a consumer can
     * address: `verseText(id)` answers the projection, and a projection offset
     * is not a source offset until the mask map carries it across, and the map
     * is only useful beside the text it indexes. Find's reference scope needs
     * the source, to turn a hit into a chapter and verse and to show the verse
     * it landed in.
     *
     * The cost is one more Bible in memory per bound reference, and the text
     * was already read off disk to register it — this keeps the string rather
     * than reading it twice.
     */
    const referenceTexts = new Map<string, string>();
    let attached: Project | undefined;
    let snapshot: FindingsSnapshot | undefined;
    let findingsCache: readonly Finding[] | undefined;
    let corpusCache: readonly Finding[] | undefined;
    let inventoryCache: Inventory | undefined;

    const pubsub = yield* PubSub.unbounded<{
      readonly bookId: BookId;
      readonly stamp: SourceStamp;
    }>();
    const latch = Latch.makeUnsafe(false);
    let lastArmed = 0;
    let burstStarted = 0;
    let armed = false;
    /** The gesture that most recently armed the scheduler. See `supply`. */
    let causedBy: string | undefined;

    const invalidateCaches = (): void => {
      findingsCache = undefined;
      corpusCache = undefined;
      inventoryCache = undefined;
    };

    /** Synchronous, called from `book.changes`. Two numbers and a latch. */
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

    /**
     * Analyze one book, registering it with the corpus in the same call.
     * Succeeds with the stamp the analysis describes, or `undefined` when the
     * engine refused the text (the previously held analysis is kept and the
     * entry stays stale).
     *
     * ONE door, not two, and so PLAIN rather than an effect. `analyze(text,
     * why, id)` registers the text and then parses off the retained copy; a
     * separate `corpus.update` beside it would send the same string across the
     * wall a second time, which is the habit the engine's maintainer measured
     * as most of a project open's cost. Nothing here leaves this thread, so a
     * generator that never yields would say otherwise.
     *
     * It is also why the corpus is not behind a port: a registration the parse
     * path cannot SEE is not a registration the parse path can name, so an
     * engine anywhere but here cannot answer `parse(id)` at all.
     */
    const refresh = (
      bookId: BookId,
      book: Book,
      entry: Entry,
      // Whoever is narrating: the pass that is running, or the root when a
      // project is opening. `refresh` cannot tell, which is the point.
      into: ObservabilityService | undefined = observability,
    ): SourceStamp | undefined => {
      const source = book.source();
      const handed = supplied.get(bookId);
      supplied.delete(bookId);
      // The editor's analysis counts only if it describes the text the Book
      // holds RIGHT NOW; a keystroke between the supply and this pass makes
      // it a stale gift, not a shortcut.
      let analysis: Analysis;
      if (handed !== undefined && describesExactly(handed, source.text)) analysis = handed;
      else {
        try {
          analysis = galley.analyze(source.text, "scheduler", bookId, into);
        } catch {
          // Retain, do not clear: an engine refusal is an integration
          // problem, not evidence that the book became clean.
          into?.note("book.analyze", "failed", "engine refused", { "book.id": bookId });
          return undefined;
        }
      }
      entry.analysis = analysis;
      entry.stamp = source.stamp;
      entry.stale = false;
      // A gift from the editor was parsed through the id door too, on the
      // keystroke that produced it, so the corpus already holds this text
      // either way and there is nothing to register here.
      const { errors } = countsOf(bookId, analysis, source.stamp);
      into?.note("book.analyze", "ready", undefined, {
        "book.id": bookId,
        "analysis.diagnostics": analysis.dish.diagnostics.length,
        "analysis.errors": errors,
      });
      return source.stamp;
    };

    /**
     * Drop one id from the corpus, never mind whether it was there.
     *
     * `remove` answers `false` for an id it never knew, which is not a failure
     * and is not interesting: every caller here is tidying up after a project
     * it is leaving.
     */
    const forget = (id: string): void => {
      try {
        galley.remove(id);
      } catch {
        // An engine that will not forget an id is an engine we are about to
        // replace the whole corpus of anyway.
      }
    };

    /**
     * One whole-corpus publication, through whichever door this host got. The
     * span carries the engine kind so a reading of the ring says which one ran
     * and how long it took there.
     *
     * A refused publication RETAINS the previous snapshot: known-stale
     * cross-book findings beat an apparently clean project.
     */
    const publishCorpus = (into: ObservabilityService | undefined = observability): void => {
      const done = into?.span("corpus.publish");
      try {
        snapshot = galley.publish();
      } catch (cause) {
        // A refused publication RETAINS the previous snapshot: known-stale
        // cross-book findings beat an apparently clean project.
        into?.note("corpus.publish", "failed", String(cause));
      }
      done?.();
    };

    /**
     * One scheduler pass: re-analyze every pending book, then publish the
     * corpus ONCE. Publishing per book would throw away the previous snapshot
     * n times and judge the corpus n times for one user gesture.
     */
    const pass = Effect.sync(() => {
      const project = attached;
      if (project === undefined) {
        pending.clear();
        return;
      }
      const todo = [...pending];
      pending.clear();
      // One pass is one piece of work, and it FOLLOWED the gestures that armed
      // it rather than happening inside any of them.
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

    const resolveBook = (
      id: string,
    ):
      | { readonly bookId: BookId; readonly stamp: SourceStamp; readonly engine: EngineStamp }
      | undefined => {
      const entry = entries.get(id);
      if (entry === undefined || entry.analysis === undefined || entry.stamp === undefined)
        return undefined;
      return { bookId: id, stamp: entry.stamp, engine: stampOf(entry.analysis) };
    };

    const crossBook = (): readonly Finding[] => {
      if (corpusCache !== undefined) return corpusCache;
      corpusCache = snapshot === undefined ? [] : fromSnapshot(snapshot, resolveBook);
      return corpusCache;
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
        // The observability IN CONTEXT NOW, not the one this module closed over
        // when its Layer was built. They are different services, and the
        // difference is the whole wide-event model: the shell opens
        // `project.open` as the reader's gesture and provides it for this call,
        // and a module that captured the root at construction narrates BESIDE
        // that gesture instead of inside it. The ring showed exactly that — a
        // 256ms `project.open` with no children, and `analysis.pass` sitting
        // next to it as a root, as though nobody had asked for it.
        //
        // Only `attach` takes it this way. The scheduler's later passes happen
        // long after any gesture has ended and correctly belong to the module's
        // own service, which is what `observability` still is everywhere else.
        const into = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
        // One project at a time. Re-attaching drops the previous corpus rather
        // than judging two projects as one — the bound references included,
        // because a resource bound to the project we are leaving is not a
        // reference for the one we are opening.
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
          // The Book publishes synchronously inside `apply`; arming is the
          // only thing allowed to happen here.
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

        // One record, not two. A span and a note under the SAME name is the
        // duplicate-emission shape `galley.parse` was already caught in: the
        // count belongs on the span that measured the work.
        const done = into?.span("analysis.pass", project.root);
        // The book the reader is about to look at goes FIRST.
        //
        // The loop is serial and the whole project is parsed before the open
        // finishes either way, so this costs nothing and changes nothing about
        // the total. What it changes is which parse the reader is waiting on:
        // in canonical order, opening JUD waits behind sixty-five books it is
        // not going to show. The editor needs one analysis to draw, and this
        // makes it the first one produced rather than the last.
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

        // A seat swap replaces the object that holds a book's canonical text,
        // so the old subscription is dead: re-resolve and re-subscribe, and
        // re-analyze because the seat may already hold different text.
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

        // The scheduling fiber. `Effect.forever` over "wait for quiet, then
        // one pass" — the numbers are re-read each lap so arming during the
        // wait extends the quiet period without restarting the deadline.
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
            // Close before the pass: an edit arriving during it re-arms and is
            // picked up by the next lap rather than being lost.
            armed = false;
            latch.closeUnsafe();
            const refreshed = yield* pass;
            for (const event of refreshed ?? []) yield* PubSub.publish(pubsub, event);
          }),
        );
        yield* Effect.forkScoped(loop);
      });

    /**
     * `keepText: true` on every one of them. A reference registered without it
     * retains verse lengths and nothing else, which is all the length lane
     * needs and nothing a search or an overlay can read — and this door exists
     * precisely for the two callers that read.
     *
     * A registration that fails is reported and skipped, not thrown: one
     * unreadable reference must not cost the others their scope.
     */
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
            // One unreadable reference must not cost the others their scope.
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
        // The most recent gesture wins: a pass serving three keystrokes names
        // the last one, which is the one whose text it is about to read.
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
      findings,
      crossBook,
      inventory: characters,
      watch: () => Stream.fromPubSub(pubsub),
    };
  });

/**
 * The Layer. Needs `Galley`, and only `Galley`: the per-book parse and the
 * whole-corpus publication are two halves of ONE handle in this process, so
 * they are one requirement.
 * Takes `Observability` optionally, so core policy runs with or without the
 * ring. It is NOT scoped: the module holds no host resource of its own, and
 * the fibers and subscriptions belong to the scope that called `attach`.
 */
export const ProjectAnalysisLive: Layer.Layer<ProjectAnalysis, never, Galley> = Layer.effect(
  ProjectAnalysis,
  Effect.gen(function* () {
    const galley = yield* Galley;
    const observability = yield* Effect.serviceOption(Observability);
    return yield* make(galley, Option.getOrUndefined(observability));
  }),
);
