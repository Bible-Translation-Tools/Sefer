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

export function createCompare(inputs: CompareInputs) {
  const { shell, services, setNote } = inputs;
  const { decisions } = inputs.decisions;
  const {
    leftId,
    rightId,
    leftPicked,
    rightPicked,
    version,
    shared,
    live,
    left,
    right,
    waitingFor,
  } = inputs.sides;
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

  let running = false;
  let again = false;

  const decidedIn = (bookId: BookId): boolean => {
    for (const key of untrack(decisions).keys()) if (key.startsWith(`${bookId}\0`)) return true;
    return false;
  };
  const inReview = (book: BookComparison): boolean => !book.identical || decidedIn(book.bookId);

  const skeletonsOf = (found: CompareResult): ReadonlyMap<BookId, SkeletonResult> => {
    const held = new Map<BookId, SkeletonResult>();
    for (const book of found.books) {
      if (!inReview(book) || book.leftText === undefined || book.rightText === undefined) continue;
      held.set(
        book.bookId,
        diffSkeleton(services.galley, book.bookId, book.rightText, book.leftText, {
          unchanged: decidedIn(book.bookId),
        }),
      );
    }
    return held;
  };

  let computed:
    | {
        readonly result: CompareResult;
        readonly skeletons: ReadonlyMap<BookId, SkeletonResult>;
      }
    | undefined;

  const runCompare = (): void => {
    const a = left();
    const b = right();
    if (a === undefined || b === undefined || a.id === b.id || waitingFor() !== undefined) {
      setResult(undefined);
      return;
    }
    if (running) {
      again = true;
      return;
    }
    running = true;
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
        running = false;
        const units = comparing.span("review.units");
        const held = skeletonsOf(found);
        let unitCount = 0;
        let refusedBooks = 0;
        for (const skeleton of held.values()) {
          if (Result.isFailure(skeleton)) refusedBooks += 1;
          else
            unitCount += skeleton.success.units.filter(
              (unit) => unit.status !== "unchanged",
            ).length;
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
        computed = { result: found, skeletons: held };
        setComparing(false);
        setNote("");
        setResult(found);
        setSelected((held) =>
          held !== undefined && found.books.some((book) => book.bookId === held && !book.identical)
            ? held
            : (found.books.find((book) => !book.identical)?.bookId ?? found.books[0]?.bookId),
        );
        if (again) {
          again = false;
          runCompare();
        }
      })
      .catch((cause: unknown) => {
        compared();
        const reason = reasonOf(cause);
        comparing.end(reason === undefined ? "failed" : "refused", {
          "review.reason": reason ?? "unknown",
        });
        running = false;
        again = false;
        setComparing(false);
        setNote(describe(cause));
      });
  };

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

  const changed = (): readonly BookComparison[] => {
    decisions();
    return result()?.books.filter(inReview) ?? [];
  };

  const current = (): BookComparison | undefined => {
    const found = result();
    const bookId = selected();
    return found === undefined || bookId === undefined ? undefined : bookComparison(found, bookId);
  };

  const skeletons = createMemo(
    (): ReadonlyMap<BookId, SkeletonResult> => {
      const found = result();
      if (found === undefined) return new Map();
      return computed?.result === found ? computed.skeletons : skeletonsOf(found);
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
          unchanged: decidedIn(book.bookId),
        })
      );
    },
    { name: "reviewSkeleton" },
  );

  const diffRefusal = (): string | undefined => {
    const found = selectedSkeleton();
    return found !== undefined && Result.isFailure(found) ? found.failure.description : undefined;
  };

  return { result, selected, setSelected, comparing, revisions, changed, skeletons, diffRefusal };
}

export type Compare = ReturnType<typeof createCompare>;
