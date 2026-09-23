/**
 * The coordinator: the shell's stores, and the one door they are written
 * through.
 *
 * Sefer's core is pure and holds no signals (`pnpm boundaries`), and Solid
 * needs signals to know what to redraw. Something has to sit between them, and
 * for a long time that something was one counter: it said "something changed
 * somewhere" and every derived read in nine screens recomputed.
 *
 * This is the replacement, and the model is one line:
 *
 *     event -> core does the work (pure) -> push the result into stores
 *              -> UI reads them
 *
 * So the shape of this file is deliberate. Everything above the stores runs on
 * an EVENT and takes plain values — `open()` hands back the Project as an
 * ordinary object, never a signal, because a coordinator that reads signals is
 * asking what is true later rather than recording what just happened (see the
 * note on `open` below; getting this wrong cost an evening). Everything the
 * shell hands to components is a store or signal read, and cheap by
 * construction: the expensive question was answered once, when the event
 * happened, for the books that event named.
 *
 * Split out of `ProjectContext` because it is one concern and that file is a
 * different one: this decides WHAT the UI knows, and ProjectContext decides
 * what a route can reach and what happens when the reader opens a book.
 *
 * There is deliberately no way for one part of the application to tell
 * another that something, somewhere, happened — every write goes through
 * `changed()` and names its books, and every read is of a row those books
 * own. See `documentation/architecture/shell.md`.
 */

import { Effect, Fiber, Option, Stream } from "effect";
import { createSignal, createStore, onCleanup, type Accessor } from "solid-js";

import type { BookSummary } from "#core/analysis/projectAnalysis";
import type { Book, BookId } from "#core/book/book";
import type { Finding } from "#core/findings/finding";
import { EMPTY as EMPTY_INVENTORY, type Inventory } from "#core/findings/inventory";
import type { Project } from "#core/project/project";
import type { SourceStamp } from "#core/source/source";

import type { Services } from "./services";
import { booksOf, type ShellEvent } from "./shellEvent";

/**
 * Where a book's text stands against the file and the last version.
 *
 *   * `unsaved` — the text on screen is not the text in the file.
 *   * `recorded` — the file holds this text and a version holds the file.
 *   * `onDisk` — the file holds this text and NO version does.
 */
export type SaveState = "unsaved" | "onDisk" | "recorded";

/** What the shell holds about one book: where it stands, and which text that is about. */
interface BookRow {
  readonly saveState: SaveState;
  readonly stamp: SourceStamp;
  /**
   * The editor's undo and redo depth.
   *
   * Here because it is the last input to a command's `when()` that is not a
   * signal — CodeMirror's history — and a predicate cannot declare a
   * dependency on something that never publishes. It is an O(1) read of a
   * field the editor already maintains, so the event path pays nothing to
   * carry it, and carrying it is what let the toolbar stop reading the
   * counter.
   *
   * The chapter table is NOT here. It belongs to the focused book alone and
   * it is an array, so holding it in a store would proxy every row for every
   * reader that walks it; `ProjectContext.outline` derives it from this row's
   * stamp instead, which is the same dependency at none of the cost.
   */
  readonly undo: number;
  readonly redo: number;
}

/** What the coordinator hands the shell. Every member is cheap to call. */
export interface ShellStores {
  /**
   * Something moved, and this says what — the one door the stores are written
   * through. Naming the event is what lets a keystroke in one book leave every
   * other book's readers asleep.
   */
  readonly changed: (event: ShellEvent) => void;
  /** Review's report after it wrote files. See `ShellEvent`'s `book.write`. */
  readonly noteWritten: (bookIds: readonly BookId[], recorded: boolean) => void;
  /** Every store emptied, for a project closing. */
  readonly clear: () => void;

  readonly unsaved: (book: Book) => boolean;
  readonly saveState: (book: Book) => SaveState;
  readonly stampOf: (bookId: BookId) => SourceStamp | undefined;
  /** How deep this book's undo and redo stacks are. Zeroes for an unseated book. */
  readonly historyDepth: (bookId: BookId) => { readonly undo: number; readonly redo: number };

  readonly findings: Accessor<readonly Finding[]>;
  readonly findingCounts: Accessor<{ readonly errors: number; readonly warnings: number }>;
  readonly summaryOf: (bookId: BookId) => BookSummary | undefined;
  readonly attentionOf: (bookId: BookId) => number;
  readonly bookCensus: Accessor<readonly BookSummary[]>;
  readonly inventory: Accessor<Inventory>;
}

export const makeShellStores = (options: {
  readonly services: Services;
  /**
   * The open project, as a plain value.
   *
   * NOT an `Accessor`, in the sense that matters: this is called on the event
   * path and must answer with the project open RIGHT NOW. A signal read in the
   * same turn as `setProject` can still answer with the previous value,
   * because Solid 2 schedules writes rather than applying them in place — and
   * when it did, `project.open` wrote no book rows at all.
   */
  readonly open: () => Project | undefined;
}): ShellStores => {
  const { services, open } = options;

  /**
   * What the project's analyses currently say, and who it is about.
   *
   * Written when a Publication lands — NOT when a keystroke happens — which is
   * the honest cue for two reasons. The held analyses do not move between
   * scheduler passes, so recomputing sooner produces the same findings from
   * the same inputs; and the corpus half is genuinely a pass behind, so counts
   * published sooner would be counts for text nobody judged.
   *
   * It retains rather than clears, which is `ProjectAnalysis`'s own rule
   * (§"Failure retains, never clears") carried up to the UI: an edit does not
   * blank the bell and the badges while the next pass runs, it leaves the last
   * published answer standing. Known-stale beats an apparently clean project.
   *
   * Both `ProjectAnalysis.findings()` and `census()` rebuild every finding in
   * every book, and `attach` invalidates their caches on every accepted edit —
   * so read per keystroke, the bell, the rail and the sixty-six sidebar rows
   * would each pay a whole-project rebuild.
   */
  // Signals for the three WHOLESALE products and a store for the one PARTIAL
  // one, which is a rule and not a stylistic choice. A
  // Publication replaces the findings list, the totals and the inventory
  // entirely — there is no such thing as half a snapshot — and putting a
  // thousand-element frozen array behind a store proxy would charge every
  // reader that iterates it for granularity it cannot use. The census is the
  // opposite: sixty-six rows that move independently, where a reader of RUT's
  // row must not wake for PSA's.
  const [findingsList, setFindingsList] = createSignal<readonly Finding[]>([], {
    name: "findings",
  });
  const [findingTotals, setFindingTotals] = createSignal(
    { errors: 0, warnings: 0 },
    { name: "findingTotals" },
  );
  const [inventoryHeld, setInventoryHeld] = createSignal<Inventory>(EMPTY_INVENTORY, {
    name: "inventory",
  });
  const [censusHeld, setCensusHeld] = createStore<Record<BookId, BookSummary>>(
    {},
    { name: "census" },
  );

  const publishFindings = (): void => {
    const staticOpen = open();
    if (staticOpen === undefined) {
      setFindingsList([]);
      setFindingTotals({ errors: 0, warnings: 0 });
      setInventoryHeld(EMPTY_INVENTORY);
      setCensusHeld((draft) => {
        for (const bookId of Object.keys(draft)) delete draft[bookId];
      });
      return;
    }
    // One rebuild, here, for every reader — rather than each of them paying
    // it separately. All three doors are memoised behind the same
    // publication, so asking for all of them costs what asking for one did.
    const list = services.projectAnalysis.findings();
    let errors = 0;
    let warnings = 0;
    for (const held of list) {
      if (held.severity === "error") errors += 1;
      else if (held.severity === "warning") warnings += 1;
    }
    const rows = services.projectAnalysis.census(staticOpen);
    setFindingsList(list);
    setFindingTotals({ errors, warnings });
    setInventoryHeld(services.projectAnalysis.inventory());
    setCensusHeld((draft) => {
      const present = new Set<BookId>();
      for (const row of rows) {
        draft[row.bookId] = row;
        present.add(row.bookId);
      }
      // A project can lose a book. Rows for books that are gone would keep
      // badging a sidebar that no longer lists them.
      for (const bookId of Object.keys(draft)) if (!present.has(bookId)) delete draft[bookId];
    });
  };

  const findings = (): readonly Finding[] => findingsList();

  const findingCounts = (): { readonly errors: number; readonly warnings: number } =>
    findingTotals();

  /**
   * One book's row of the last Publication — its counts, its chapter and verse
   * totals, and the stamp they were measured against.
   *
   * A read of one row of the store, so a publication that changed RUT's row
   * does not wake the sixty-five it did not.
   */
  const summaryOf = (bookId: BookId): BookSummary | undefined => censusHeld[bookId];

  const attentionOf = (bookId: BookId): number => {
    const held = censusHeld[bookId];
    return held === undefined ? 0 : held.diagnostics.errors + held.diagnostics.warnings;
  };

  /** The whole census, in the project's own book order. */
  const bookCensus = (): readonly BookSummary[] => {
    // Untracked, and correct: every change to the census is a write to
    // `censusHeld` above, which is what wakes this. A project opening or
    // closing writes it too.
    const staticOpen = open();
    if (staticOpen === undefined) return [];
    return staticOpen.books.flatMap((book) => {
      const row = censusHeld[book.id];
      return row === undefined ? [] : [row];
    });
  };

  /** The character inventory of the last Publication. */
  const inventory = (): Inventory => inventoryHeld();

  /**
   * Books whose bytes are on disk with no version behind them: a `saveAll`
   * that succeeded under a `git.commit` that did not. A plain Set because
   * `saveStateOf` is now its only reader, and that runs on an event rather
   * than on a render.
   */
  const onDisk = new Set<BookId>();

  /**
   * One book's save state, asked of the modules that own it.
   *
   * A book with no adopted baseline was never opened this session: nothing on
   * screen can differ from disk, so it is not "unsaved" — `dirty` alone would
   * badge every untouched book on the project page.
   *
   * NOT reactive, and that is the whole point. This is the computation a
   * `ShellEvent` provokes: it runs once per event, for the books that event
   * named, and its answer is written into `books`. `dirty` can cost an engine
   * hash, so no render may reach it — read reactively it would cost several
   * whole parses per keystroke, per badged book.
   */
  const saveStateOf = (book: Book): SaveState => {
    if (Option.isSome(services.save.baseline(book)) && services.save.dirty(book)) return "unsaved";
    return onDisk.has(book.id) ? "onDisk" : "recorded";
  };

  /**
   * Every open book's save state, pushed rather than polled.
   *
   * A store and not a signal because the state is per book and moves per book:
   * a store write that does not change a row wakes nobody, so an event naming
   * RUT costs one comparison and leaves PSA's row — and PSA's reader —
   * untouched. A single change counter could not express that granularity.
   *
   * Every book of the open project has a row, written at `project.open`. A
   * missing row therefore means the book is not in the open project, and
   * `recorded` is the honest answer for it: nothing here has anything to say.
   */
  const [books, setBooks] = createStore<Record<BookId, BookRow>>({}, { name: "books" });

  const refreshBooks = (which: readonly BookId[] | "all"): void => {
    const staticOpen = open();
    if (staticOpen === undefined) return;
    const moved =
      which === "all"
        ? staticOpen.books
        : which.flatMap((bookId) => {
            // Through the project, not a held reference: `project.book` is
            // what knows whether a book is seated, and a seated book is the
            // one holding the text that was just edited.
            const book = staticOpen.book(bookId);
            return book === undefined ? [] : [book];
          });
    if (moved.length === 0) return;
    setBooks((draft) => {
      for (const book of moved) {
        // The stamp as well as the state, because the stamp is what every
        // "has this moved since?" question compares against — a finding's
        // staleness, a flagged site's, the editor's status line — and those
        // are the questions that DO change on a keystroke. Held per book, so
        // typing in RUT leaves PSA's row alone.
        const depth = book.history()?.depth();
        draft[book.id] = {
          saveState: saveStateOf(book),
          stamp: book.source().stamp,
          undo: depth?.undo ?? 0,
          redo: depth?.redo ?? 0,
        };
      }
    });
  };

  /**
   * Something moved, and this is what it was.
   *
   * The one door the stores are written through, and now the only one. What
   * a caller gains by naming its event is that only the books it names are
   * re-examined; what the application gains is that `shellEvent.ts` is a
   * readable list of everything that can change the UI.
   */
  const changed = (event: ShellEvent): void => {
    if (event.kind === "book.write")
      for (const bookId of event.books) {
        if (event.recorded) onDisk.delete(bookId);
        else onDisk.add(bookId);
      }
    refreshBooks(booksOf(event));
    // The two events that move findings. An edit is NOT one of them: it arms
    // the scheduler, and the Publication that follows is what has something
    // new to say.
    if (event.kind === "project.open" || event.kind === "corpus.publish") publishFindings();
  };

  /**
   * A Publication landed, so the findings store is rewritten.
   *
   * Coalesced, because `watch()` republishes once per book a pass refreshed
   * and a pass over forty books is still ONE publication: without this, a
   * bulk format would rebuild the whole project's findings forty times to
   * answer one question. A timeout rather than a microtask because the
   * republishes arrive from a forked fiber and need not share a tick.
   */
  let publishPending: ReturnType<typeof setTimeout> | undefined;
  const watchingAnalysis = services.runtime.runFork(
    Stream.runForEach(services.projectAnalysis.watch(), () =>
      Effect.sync(() => {
        if (publishPending !== undefined) return;
        publishPending = setTimeout(() => {
          publishPending = undefined;
          changed({ kind: "corpus.publish" });
        }, 0);
      }),
    ),
  );
  onCleanup(() => {
    if (publishPending !== undefined) clearTimeout(publishPending);
    Effect.runFork(Fiber.interrupt(watchingAnalysis));
  });

  const noteWritten = (bookIds: readonly BookId[], recorded: boolean): void => {
    changed({ kind: "book.write", books: bookIds, recorded });
  };

  const unsaved = (book: Book): boolean => books[book.id]?.saveState === "unsaved";

  const saveState = (book: Book): SaveState => books[book.id]?.saveState ?? "recorded";

  /**
   * The stamp of the text this book currently holds, as the last event
   * reported it.
   *
   * The one per-book fact that genuinely moves on every keystroke, which is
   * why it is a store row and not a counter: the book being typed in wakes its
   * own readers and nobody else's.
   */
  const stampOf = (bookId: BookId): SourceStamp | undefined => books[bookId]?.stamp;

  const NO_HISTORY = { undo: 0, redo: 0 } as const;

  const historyDepth = (bookId: BookId): { readonly undo: number; readonly redo: number } => {
    const row = books[bookId];
    return row === undefined ? NO_HISTORY : { undo: row.undo, redo: row.redo };
  };

  const clear = (): void => {
    setBooks((draft) => {
      for (const bookId of Object.keys(draft)) delete draft[bookId];
    });
    publishFindings();
  };

  return {
    changed,
    noteWritten,
    clear,
    unsaved,
    saveState,
    stampOf,
    historyDepth,
    findings,
    findingCounts,
    summaryOf,
    attentionOf,
    bookCensus,
    inventory,
  };
};
