import type { BookId } from "@sefer/text/book";

import type { DecisionUnit, DiffSkeleton } from "#core/galley";

import type { useShell } from "../../../ProjectContext";
import { isFormatting, type DiffSides, type Hunk } from "../../diff";
import type { createCardViews } from "../../multibuffer/cardViews";

export interface ReviewBook {
  readonly bookId: BookId;
  readonly name: string;
  readonly currentText: string;
  readonly baselineText: string;
  readonly skeleton: DiffSkeleton;
  readonly hidden?: ReadonlySet<string>;
}

export type Layout = "auto" | "split" | "unified";
export type Scope = "changes" | "book";
export type Filter = "all" | "words" | "formatting";

export const AUTO_SPLIT_PX = 960;

export const FILTERS: Record<Filter, (unit: DecisionUnit) => boolean> = {
  all: () => true,
  words: (unit) => !isFormatting(unit),
  formatting: isFormatting,
};

export interface Prepared {
  readonly book: ReviewBook;
  readonly sides: DiffSides;
  readonly units: readonly DecisionUnit[];
  readonly shown: readonly DecisionUnit[];
  readonly hunks: readonly Hunk[];
}

export type CardViews = ReturnType<typeof createCardViews<never>>;
export type Observability = ReturnType<typeof useShell>["services"]["composition"]["observability"];
