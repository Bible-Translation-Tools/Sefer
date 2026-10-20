import type { Book, BookId } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";
import { Effect, Fiber, Option, Stream } from "effect";
import { createSignal, createStore, onCleanup, type Accessor } from "solid-js";

import type { BookSummary } from "#core/analysis/projectAnalysis";
import type { Finding } from "#core/findings/finding";
import { EMPTY as EMPTY_INVENTORY, type Inventory } from "#core/findings/inventory";
import type { Project } from "#core/project/project";

import type { Services } from "./services";
import { booksOf, type ShellEvent } from "./shellEvent";

export type SaveState = "unsaved" | "onDisk" | "recorded";

interface BookRow {
  readonly saveState: SaveState;
  readonly stamp: SourceStamp;
  readonly undo: number;
  readonly redo: number;
}

export interface ShellStores {
  readonly changed: (event: ShellEvent) => void;
  readonly noteWritten: (bookIds: readonly BookId[], recorded: boolean) => void;
  readonly clear: () => void;

  readonly unsaved: (book: Book) => boolean;
  readonly saveState: (book: Book) => SaveState;
  readonly stampOf: (bookId: BookId) => SourceStamp | undefined;
  readonly historyDepth: (bookId: BookId) => { readonly undo: number; readonly redo: number };

  readonly findings: Accessor<readonly Finding[]>;
  readonly findingsPending: Accessor<boolean>;
  readonly findingCounts: Accessor<{ readonly errors: number; readonly warnings: number }>;
  readonly summaryOf: (bookId: BookId) => BookSummary | undefined;
  readonly bookCensus: Accessor<readonly BookSummary[]>;
  readonly inventory: Accessor<Inventory>;
}

export const makeShellStores = (options: {
  readonly services: Services;
  readonly open: () => Project | undefined;
}): ShellStores => {
  const { services, open } = options;

  const [findingsVersion, setFindingsVersion] = createSignal(0, { name: "findingsVersion" });
  const [findingsPending, setFindingsPending] = createSignal(false, { name: "findingsPending" });
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
      setFindingsVersion((n) => n + 1);
      setFindingTotals({ errors: 0, warnings: 0 });
      setInventoryHeld(EMPTY_INVENTORY);
      setCensusHeld((draft) => {
        for (const bookId of Object.keys(draft)) delete draft[bookId];
      });
      return;
    }
    setFindingsPending(false);
    const totals = services.projectAnalysis.findingTotals();
    const rows = services.projectAnalysis.census(staticOpen);
    setFindingsVersion((n) => n + 1);
    setFindingTotals(totals);
    setInventoryHeld(services.projectAnalysis.inventory());
    setCensusHeld((draft) => {
      const present = new Set<BookId>();
      for (const row of rows) {
        draft[row.bookId] = row;
        present.add(row.bookId);
      }
      for (const bookId of Object.keys(draft)) if (!present.has(bookId)) delete draft[bookId];
    });
  };

  const findings = (): readonly Finding[] => {
    findingsVersion();
    return open() === undefined ? [] : services.projectAnalysis.findings();
  };

  const findingCounts = (): { readonly errors: number; readonly warnings: number } =>
    findingTotals();

  const summaryOf = (bookId: BookId): BookSummary | undefined => censusHeld[bookId];

  const bookCensus = (): readonly BookSummary[] => {
    // Untracked on purpose: every census change is a write to censusHeld, which wakes this.
    const staticOpen = open();
    if (staticOpen === undefined) return [];
    return staticOpen.books.flatMap((book) => {
      const row = censusHeld[book.id];
      return row === undefined ? [] : [row];
    });
  };

  const inventory = (): Inventory => inventoryHeld();

  const onDisk = new Set<BookId>();

  const saveStateOf = (book: Book): SaveState => {
    if (Option.isSome(services.save.baseline(book)) && services.save.dirty(book)) return "unsaved";
    return onDisk.has(book.id) ? "onDisk" : "recorded";
  };

  const [books, setBooks] = createStore<Record<BookId, BookRow>>({}, { name: "books" });

  const refreshBooks = (which: readonly BookId[] | "all"): void => {
    const staticOpen = open();
    if (staticOpen === undefined) return;
    const moved =
      which === "all"
        ? staticOpen.books
        : which.flatMap((bookId) => {
            const book = staticOpen.book(bookId);
            return book === undefined ? [] : [book];
          });
    if (moved.length === 0) return;
    setBooks((draft) => {
      for (const book of moved) {
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

  const changed = (event: ShellEvent): void => {
    if (event.kind === "book.write")
      for (const bookId of event.books) {
        if (event.recorded) onDisk.delete(bookId);
        else onDisk.add(bookId);
      }
    refreshBooks(booksOf(event));
    if (
      event.kind === "project.open" ||
      event.kind === "corpus.publish" ||
      event.kind === "findings.suppress"
    )
      publishFindings();
    if (event.kind === "corpus.rejudge") setFindingsPending(true);
  };

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
    findingsPending,
    findingCounts,
    summaryOf,
    bookCensus,
    inventory,
  };
};
