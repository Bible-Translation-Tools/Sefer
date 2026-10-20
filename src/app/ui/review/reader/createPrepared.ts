import type { BookId } from "@sefer/text/book";
import { createEffect, createSignal, untrack, type Accessor } from "solid-js";

import type { Analysis, DecisionUnit, MergeSide } from "#core/galley";

import { changed, hunksOf, type DiffSides } from "../../diff";
import {
  FILTERS,
  type CardViews,
  type Filter,
  type Observability,
  type Prepared,
  type ReviewBook,
} from "./types";

export interface PreparedOptions {
  readonly books: () => readonly ReviewBook[];
  readonly decidable: () => boolean;
  readonly filter: () => Filter;
  readonly decision: (bookId: BookId, unitId: string) => MergeSide | undefined;
  readonly views: CardViews;
  readonly analysisOf: (bookId: BookId, side: "current" | "baseline", text: string) => Analysis;
  readonly label: Parameters<typeof hunksOf>[0]["label"];
  readonly excerptSteps: () => number;
  readonly observability: Observability;
}

export function createPrepared(options: PreparedOptions): Accessor<readonly Prepared[]> {
  const { views, analysisOf, observability } = options;
  const [prepared, setPrepared] = createSignal<readonly Prepared[]>([], {
    name: "reviewPrepared",
  });

  const extentsOf = (bookId: BookId): string =>
    [...untrack(views.extents).entries()]
      .filter(([key]) => key.startsWith(`${bookId} `))
      .map(
        ([key, extent]) => `${key}=${extent.up}/${extent.down}/${extent.chapter === true ? 1 : 0}`,
      )
      .join(",");

  const prepare = (book: ReviewBook, steps: number, show: Filter, result: boolean): Prepared => {
    const sides: DiffSides = {
      bookId: book.bookId,
      currentText: book.currentText,
      baselineText: book.baselineText,
      current: analysisOf(book.bookId, "current", book.currentText),
      baseline: analysisOf(book.bookId, "baseline", book.baselineText),
    };
    const units = book.skeleton.units;
    const filtered = FILTERS[show];
    const hidden = book.hidden;
    const include =
      hidden === undefined || hidden.size === 0
        ? filtered
        : (unit: DecisionUnit): boolean => filtered(unit) && !hidden.has(unit.id);
    const keep = (unit: DecisionUnit): boolean =>
      result && untrack(() => options.decision(book.bookId, unit.id)) !== undefined;
    return {
      book,
      sides,
      units,
      shown: units.filter((unit) => (changed(unit) && include(unit)) || keep(unit)),
      hunks: hunksOf({
        label: options.label,
        bookId: book.bookId,
        units,
        baseline: sides.baseline,
        current: sides.current,
        steps,
        extentOf: views.extentOf,
        include,
        keep,
      }),
    };
  };

  let held = new Map<BookId, { readonly key: string; readonly prepared: Prepared }>();
  const keyOf = (book: ReviewBook, show: Filter, result: boolean): string =>
    `${show}\0${result ? "r" : "c"}\0${book.currentText.length}\0${book.baselineText.length}\0${extentsOf(book.bookId)}\0${[...(book.hidden ?? [])].join(",")}`;
  const same = (was: Prepared, book: ReviewBook): boolean =>
    was.book.currentText === book.currentText && was.book.baselineText === book.baselineText;

  createEffect(
    () => ({
      books: options.books(),
      show: options.filter(),
      result: options.decidable(),
      widened: views.extents(),
    }),
    ({ books, show, result }) => {
      const steps = options.excerptSteps();
      const operation = observability.operation("review.diff.prepare", {
        "review.books": books.length,
        "review.filter": show,
        "review.mode": result ? "result" : "compare",
      });
      const before = held;
      const kept = new Map<BookId, { readonly key: string; readonly prepared: Prepared }>();
      const queue: ReviewBook[] = [];
      let reused = 0;
      for (const book of books) {
        const key = keyOf(book, show, result);
        const was = before.get(book.bookId);
        if (was !== undefined && was.key === key && same(was.prepared, book)) {
          kept.set(book.bookId, was);
          reused += 1;
        } else queue.push(book);
      }
      held = kept;
      const list = (): Prepared[] => {
        const out: Prepared[] = [];
        for (const book of books) {
          const entry = held.get(book.bookId)?.prepared ?? before.get(book.bookId)?.prepared;
          if (entry !== undefined) out.push(entry);
        }
        return out;
      };
      setPrepared(list());
      let stopped = false;
      let at = 0;
      const next = (): void => {
        if (stopped) return;
        const book = queue[at];
        if (book === undefined) {
          operation.end("passed", {
            "review.reused": reused,
            "review.prepared": queue.length,
            "review.cards": list().reduce((sum, entry) => sum + entry.hunks.length, 0),
          });
          return;
        }
        at += 1;
        const done = operation.span("review.diff.book", book.bookId);
        const prepared = prepare(book, steps, show, result);
        done({ "review.units": prepared.shown.length, "review.cards": prepared.hunks.length });
        held.set(book.bookId, { key: keyOf(book, show, result), prepared });
        setPrepared(list());
        if (at < queue.length) setTimeout(next, 0);
        else next();
      };
      next();
      return () => {
        stopped = true;
      };
    },
  );

  return prepared;
}
