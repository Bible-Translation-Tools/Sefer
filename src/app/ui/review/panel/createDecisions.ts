import type { BookId } from "@sefer/text/book";
import { createSignal } from "solid-js";

import type { DecisionUnit, MergeSide } from "#core/galley";

import { keyOf } from "./helpers";

export function createDecisions() {
  const [decisions, setDecisions] = createSignal<ReadonlyMap<string, MergeSide>>(new Map(), {
    name: "reviewDecisions",
  });
  const [receipt, setReceipt] = createSignal("", { name: "reviewReceipt" });
  const [showChoices, setShowChoices] = createSignal(false, { name: "reviewShowChoices" });
  const originals = new Map<BookId, string>();

  const startOver = (): void => {
    setDecisions(new Map());
    originals.clear();
    setReceipt("");
    setShowChoices(false);
  };

  const decisionFor = (bookId: BookId, unitId: string): MergeSide | undefined =>
    decisions().get(keyOf(bookId, unitId));

  const decide = (
    bookId: BookId,
    staticUnits: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ): void => {
    setDecisions((held) => {
      const next = new Map(held);
      for (const unit of staticUnits) {
        const key = keyOf(bookId, unit.id);
        if (side === undefined) next.delete(key);
        else next.set(key, side);
      }
      return next;
    });
  };

  return {
    decisions,
    receipt,
    showChoices,
    setShowChoices,
    originals,
    startOver,
    decisionFor,
    decide,
  };
}

export type Decisions = ReturnType<typeof createDecisions>;
