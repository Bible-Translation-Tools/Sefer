import { Refusal, trustedBy, type Book, type BookId, type Receipt } from "@sefer/text/book";
import type { SourceStamp } from "@sefer/text/source";
import { Result } from "effect";

import type { DecisionUnit, GalleyService } from "../galley";
import { diffSkeleton } from "./skeleton";

export interface BaselineLike {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
  readonly text: string;
}

export interface UnitChanges {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
  readonly baselineText: string;
  readonly workingText: string;
  readonly units: readonly DecisionUnit[];
}

export const unitChanges = (
  galley: GalleyService,
  book: Book,
  baseline: BaselineLike,
): Result.Result<UnitChanges, Refusal> => {
  const source = book.source();
  return textChanges(galley, baseline.bookId, source.stamp, baseline.text, source.text);
};

export const textChanges = (
  galley: GalleyService,
  bookId: BookId,
  stamp: SourceStamp,
  baselineText: string,
  workingText: string,
): Result.Result<UnitChanges, Refusal> => {
  const base = { bookId, stamp, baselineText, workingText };
  if (baselineText === workingText) return Result.succeed({ ...base, units: [] });
  const found = diffSkeleton(galley, bookId, baselineText, workingText);
  if (Result.isFailure(found))
    return Result.fail(
      new Refusal({ rule: "diff.units", reason: "Engine", description: found.failure.description }),
    );
  return Result.succeed({
    ...base,
    units: found.success.units.filter((unit) => unit.status !== "unchanged"),
  });
};

const refuseRevert = (reason: string, description: string): Refusal =>
  new Refusal({ rule: "diff.revert", reason, description });

export const revertUnits = (
  galley: GalleyService,
  book: Book,
  changes: UnitChanges,
  units: readonly DecisionUnit[],
): Result.Result<Receipt, Refusal> => {
  if (units.length === 0) return Result.fail(refuseRevert("Empty", "there is nothing to revert"));
  const stamp = book.source().stamp;
  if (
    book.id !== changes.bookId ||
    stamp.revision !== changes.stamp.revision ||
    stamp.length !== changes.stamp.length
  )
    return Result.fail(refuseRevert("Stale", "the book changed after its changes were computed"));
  const splices = galley.mergeSplices(
    changes.workingText,
    changes.baselineText,
    new Map(units.map((unit) => [unit.id, "current" as const])),
    "baseline",
  );
  if (Result.isFailure(splices))
    return Result.fail(refuseRevert("Engine", splices.failure.description));
  if (splices.success.length === 0)
    return Result.fail(refuseRevert("Empty", "there is nothing to revert"));
  return book.apply(splices.success, "revert", trustedBy("diff.revert"));
};
