import type { BookId } from "@sefer/text/book";
import { Effect, Result } from "effect";
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import {
  bookComparison,
  compareBooks,
  type BookComparison,
  type CompareResult,
} from "#core/compare";
import { diffSkeleton, type SkeletonResult } from "#core/diff/skeleton";
import { Observability } from "#core/observability";

import { describe, reasonOf } from "../../../describe";
import type { Shell } from "../../../ProjectContext";
import type { Services } from "../../../services";
import type { Decisions } from "./createDecisions";
import type { Sides } from "./createSides";
import { TYPING_PAUSE_MS } from "./helpers";

export interface CompareInputs {
  readonly shell: Shell;
  readonly services: Services;
  readonly sides: Sides;
  readonly decisions: Decisions;
  readonly setNote: (note: string) => void;
}

type Operation = ReturnType<Services["composition"]["observability"]["operation"]>;
type Computed = {
  readonly result: CompareResult;
  readonly skeletons: ReadonlyMap<BookId, SkeletonResult>;
};

const decidedIn = (decisions: Decisions["decisions"], bookId: BookId): boolean => {
  for (const key of untrack(decisions).keys()) if (key.startsWith(`${bookId}\0`)) return true;
  return false;
};

const inReview = (decisions: Decisions["decisions"], book: BookComparison): boolean =>
  !book.identical || decidedIn(decisions, book.bookId);

const skeletonsOf = (
  services: Services,
  decisions: Decisions["decisions"],
  found: CompareResult,
): ReadonlyMap<BookId, SkeletonResult> => {
  const held = new Map<BookId, SkeletonResult>();
  for (const book of found.books) {
    if (!inReview(decisions, book) || book.leftText === undefined || book.rightText === undefined)
      continue;
    held.set(
      book.bookId,
      diffSkeleton(services.galley, book.bookId, book.rightText, book.leftText, {
        unchanged: decidedIn(decisions, book.bookId),
      }),
    );
  }
  return held;
};

const endComparing = (
  comparing: Operation,
  found: CompareResult,
  held: ReadonlyMap<BookId, SkeletonResult>,
  units: (attributes: Record<string, number>) => void,
): void => {
  let unitCount = 0;
  let refusedBooks = 0;
  for (const skeleton of held.values()) {
    if (Result.isFailure(skeleton)) refusedBooks += 1;
    else unitCount += skeleton.success.units.filter((unit) => unit.status !== "unchanged").length;
  }
  units({ "review.unit_books": held.size });
  comparing.end(refusedBooks > 0 ? "refused" : "passed", {
    "review.books": found.books.length,
    "review.changed": found.changedBooks,
    "review.left_only": found.leftOnly,
    "review.right_only": found.rightOnly,
    "review.unit_books": held.size,
    "review.units": unitCount,
    "review.refused_books": refusedBooks,
  });
};

const keepSelected = (held: BookId | undefined, found: CompareResult): BookId | undefined =>
  held !== undefined && found.books.some((book) => book.bookId === held && !book.identical)
    ? held
    : (found.books.find((book) => !book.identical)?.bookId ?? found.books[0]?.bookId);

const refuseCompare = (comparing: Operation, compared: () => void, cause: unknown): void => {
  compared();
  const reason = reasonOf(cause);
  comparing.end(reason === undefined ? "failed" : "refused", {
    "review.reason": reason ?? "unknown",
  });
};

interface CompareSetters {
  readonly setResult: (found: CompareResult | undefined) => void;
  readonly setSelected: (pick: (held: BookId | undefined) => BookId | undefined) => void;
  readonly setComparing: (value: boolean) => void;
}

function createCompareRun(inputs: CompareInputs, setters: CompareSetters) {
  const { services, setNote } = inputs;
  const { decisions } = inputs.decisions;
  const { leftId, rightId, live, left, right, waitingFor } = inputs.sides;
  const { setResult, setSelected, setComparing } = setters;
  const state: { running: boolean; again: boolean; computed: Computed | undefined } = {
    running: false,
    again: false,
    computed: undefined,
  };

  const runCompare = (): void => {
    const a = left();
    const b = right();
    if (a === undefined || b === undefined || a.id === b.id || waitingFor() !== undefined) {
      setResult(undefined);
      return;
    }
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    setComparing(true);
    const comparing = services.composition.observability.operation("review.compare", {
      "review.left": leftId(),
      "review.right": rightId(),
      "review.live": live(),
    });
    const compared = comparing.span("review.books");
    void services
      .run(Effect.provideService(compareBooks(a, b), Observability, comparing))
      .then((found) => {
        compared({ "review.books": found.books.length });
        state.running = false;
        const units = comparing.span("review.units");
        const held = skeletonsOf(services, decisions, found);
        endComparing(comparing, found, held, units);
        state.computed = { result: found, skeletons: held };
        setComparing(false);
        setNote("");
        setResult(found);
        setSelected((held) => keepSelected(held, found));
        if (state.again) {
          state.again = false;
          runCompare();
        }
      })
      .catch((cause: unknown) => {
        refuseCompare(comparing, compared, cause);
        state.running = false;
        state.again = false;
        setComparing(false);
        setNote(describe(cause));
      });
  };

  return { runCompare, computed: () => state.computed };
}

function watchSides(inputs: CompareInputs, revisions: () => string, runCompare: () => void): void {
  const { leftId, rightId, leftPicked, rightPicked, version, shared, live } = inputs.sides;
  let lastSides: string | undefined;
  let typing: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (typing !== undefined) clearTimeout(typing);
  });
  createEffect(
    () => ({
      sides: `${leftId()}:${rightId()}:${leftPicked()?.id ?? ""}:${rightPicked()?.id ?? ""}:${
        version.recorded().head ?? ""
      }:${shared.recorded().head ?? ""}:${version.recorded().read}:${shared.recorded().read}`,
      text: live() ? revisions() : "",
    }),
    ({ sides }) => {
      // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
      if (typing !== undefined) clearTimeout(typing);
      if (sides !== lastSides) {
        lastSides = sides;
        untrack(runCompare);
        return;
      }
      typing = setTimeout(() => {
        typing = undefined;
        untrack(runCompare);
      }, TYPING_PAUSE_MS);
    },
  );
}

function createSkeletons(
  inputs: CompareInputs,
  result: () => CompareResult | undefined,
  selected: () => BookId | undefined,
  computed: () => Computed | undefined,
) {
  const { services } = inputs;
  const { decisions } = inputs.decisions;
  const current = (): BookComparison | undefined => {
    const found = result();
    const bookId = selected();
    return found === undefined || bookId === undefined ? undefined : bookComparison(found, bookId);
  };

  const skeletons = createMemo(
    (): ReadonlyMap<BookId, SkeletonResult> => {
      const found = result();
      if (found === undefined) return new Map();
      const held = computed();
      return held?.result === found ? held.skeletons : skeletonsOf(services, decisions, found);
    },
    { name: "reviewSkeletons" },
  );

  const selectedSkeleton = createMemo(
    (): SkeletonResult | undefined => {
      const book = current();
      if (book === undefined || book.leftText === undefined || book.rightText === undefined)
        return undefined;
      return (
        skeletons().get(book.bookId) ??
        diffSkeleton(services.galley, book.bookId, book.rightText, book.leftText, {
          unchanged: decidedIn(decisions, book.bookId),
        })
      );
    },
    { name: "reviewSkeleton" },
  );

  const diffRefusal = (): string | undefined => {
    const found = selectedSkeleton();
    return found !== undefined && Result.isFailure(found) ? found.failure.description : undefined;
  };

  return { skeletons, diffRefusal };
}

export function createCompare(inputs: CompareInputs) {
  const { shell } = inputs;
  const { decisions } = inputs.decisions;
  const [result, setResult] = createSignal<CompareResult | undefined>(undefined, {
    name: "reviewResult",
  });
  const [selected, setSelected] = createSignal<BookId | undefined>(undefined, {
    name: "reviewBook",
  });
  const [comparing, setComparing] = createSignal(false, { name: "reviewComparing" });

  const revisions = (): string => {
    const project = shell.project();
    if (project === undefined) return "";
    return project.books.map((book) => shell.stampOf(book.id)?.revision ?? -1).join(",");
  };

  const { runCompare, computed } = createCompareRun(inputs, {
    setResult,
    setSelected,
    setComparing,
  });
  watchSides(inputs, revisions, runCompare);

  const changed = (): readonly BookComparison[] => {
    decisions();
    return result()?.books.filter((book) => inReview(decisions, book)) ?? [];
  };

  const { skeletons, diffRefusal } = createSkeletons(inputs, result, selected, computed);

  return { result, selected, setSelected, comparing, revisions, changed, skeletons, diffRefusal };
}

export type Compare = ReturnType<typeof createCompare>;
