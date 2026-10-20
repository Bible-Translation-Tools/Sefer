import type { BookId } from "@sefer/text/book";
import { Result } from "effect";
import { createMemo, createSignal } from "solid-js";

import type { BookComparison } from "#core/compare";
import type { DecisionUnit, MergeSide } from "#core/galley";

import type { Services } from "../../../services";
import type { ReviewBook } from "../ReviewReader";
import type { Compare } from "./createCompare";
import type { Decisions } from "./createDecisions";
import type { ReviewRoute } from "./createReviewRoute";
import type { Sides } from "./createSides";
import { changedSinceOf, originAmong, type ChangedSides } from "./helpers";

export interface UnitsInputs {
  readonly services: Services;
  readonly route: ReviewRoute;
  readonly sides: Sides;
  readonly decisions: Decisions;
  readonly compare: Compare;
  readonly nameOf: (bookId: BookId) => string;
}

export function createUnits(inputs: UnitsInputs) {
  const { services, nameOf } = inputs;
  const { pull } = inputs.route;
  const { rightId, againstShared, common } = inputs.sides;
  const { decisions, decisionFor } = inputs.decisions;
  const { changed, skeletons } = inputs.compare;

  const reviewBooks = createMemo(
    (): readonly ReviewBook[] => {
      const out: ReviewBook[] = [];
      for (const book of changed()) {
        if (book.leftText === undefined || book.rightText === undefined) continue;
        const found = skeletons().get(book.bookId);
        if (found === undefined || Result.isFailure(found)) continue;
        out.push({
          bookId: book.bookId,
          name: nameOf(book.bookId),
          currentText: book.leftText,
          baselineText: book.rightText,
          skeleton: found.success,
        });
      }
      return out;
    },
    { name: "reviewBooks" },
  );

  const changedSince = createMemo(
    (): ReadonlyMap<BookId, ChangedSides> => {
      if (!againstShared()) return new Map();
      const base = common.recorded();
      const editorOnLeft = rightId() === "shared";
      return changedSinceOf(services, base.texts, editorOnLeft, reviewBooks());
    },
    { name: "reviewChangedSince" },
  );

  const originOf = (
    bookId: BookId,
    units: readonly DecisionUnit[],
  ): "there" | "here" | "both" | undefined => originAmong(changedSince().get(bookId), units);

  const mineOnly = createMemo(
    (): ReadonlyMap<BookId, ReadonlySet<string>> => {
      const out = new Map<BookId, ReadonlySet<string>>();
      if (pull() === undefined) return out;
      for (const book of reviewBooks()) {
        const ids = new Set<string>();
        for (const unit of book.skeleton.units)
          if (unit.status !== "unchanged" && originOf(book.bookId, [unit]) === "here")
            ids.add(unit.id);
        if (ids.size > 0) out.set(book.bookId, ids);
      }
      return out;
    },
    { name: "reviewMineOnly" },
  );
  const mineOnlyCount = (): number =>
    [...mineOnly().values()].reduce((sum, ids) => sum + ids.size, 0);
  const [showMine, setShowMine] = createSignal(false, { name: "reviewShowMine" });

  const readerBooks = createMemo(
    (): readonly ReviewBook[] => {
      const books = reviewBooks();
      const hide = mineOnly();
      if (showMine() || hide.size === 0) return books;
      return books.map((book) => {
        const hidden = hide.get(book.bookId);
        return hidden === undefined ? book : { ...book, hidden };
      });
    },
    { name: "reviewReaderBooks" },
  );

  const offeredCount = (): number => {
    let count = 0;
    for (const book of reviewBooks())
      for (const unit of book.skeleton.units) if (unit.status !== "unchanged") count += 1;
    return count - mineOnlyCount();
  };

  const preset = (bookId: BookId, unit: DecisionUnit): MergeSide | undefined => {
    if (!againstShared()) return undefined;
    const origin = originOf(bookId, [unit]);
    if (origin === "there") return "baseline";
    return origin === "here" ? "current" : undefined;
  };

  const effectiveFor = (bookId: BookId, unitId: string): MergeSide | undefined => {
    const held = decisionFor(bookId, unitId);
    if (held !== undefined || !againstShared()) return held;
    const unit = reviewBooks()
      .find((book) => book.bookId === bookId)
      ?.skeleton.units.find((entry) => entry.id === unitId);
    return unit === undefined ? undefined : preset(bookId, unit);
  };

  const suggestionTally = (): { readonly offered: number; readonly taken: number } => {
    let offered = 0;
    let taken = 0;
    if (pull() === undefined) return { offered, taken };
    for (const side of decisions().values()) {
      offered += 1;
      if (side === "baseline") taken += 1;
    }
    for (const book of reviewBooks())
      for (const unit of book.skeleton.units) {
        if (unit.status === "unchanged" || decisionFor(book.bookId, unit.id) !== undefined)
          continue;
        offered += 1;
        if (preset(book.bookId, unit) === "baseline") taken += 1;
      }
    return { offered, taken };
  };
  const declineOnly = (): boolean => {
    const tally = suggestionTally();
    return tally.offered > 0 && tally.taken === 0;
  };

  const undecidedBoth = (): number => {
    if (!againstShared()) return 0;
    let count = 0;
    for (const book of reviewBooks())
      for (const unit of book.skeleton.units)
        if (
          unit.status !== "unchanged" &&
          decisionFor(book.bookId, unit.id) === undefined &&
          preset(book.bookId, unit) === undefined
        )
          count += 1;
    return count;
  };

  const totals = () => {
    let total = 0;
    let decided = 0;
    for (const book of reviewBooks())
      for (const unit of book.skeleton.units) {
        const held = effectiveFor(book.bookId, unit.id);
        if (unit.status === "unchanged" && held === undefined) continue;
        total += 1;
        if (held !== undefined) decided += 1;
      }
    return { total, decided };
  };

  const oneSided = (): readonly BookComparison[] =>
    changed().filter((book) => book.presence !== "both");

  return {
    reviewBooks,
    originOf,
    mineOnlyCount,
    showMine,
    setShowMine,
    readerBooks,
    offeredCount,
    preset,
    effectiveFor,
    declineOnly,
    undecidedBoth,
    totals,
    oneSided,
  };
}

export type Units = ReturnType<typeof createUnits>;
