// units.ts
//
// "What changed in a Book since a baseline, and how to put some of it back",
// in the engine's decision units — the verse, the bridge, a chapter's opening
// matter — rather than in lines. The replacement for the line diff History
// used: one alignment in the whole application, the engine's, whether the
// question is asked by Review, History or a write.
//
// Pure and synchronous, like the module it replaces: it consumes the baseline
// VALUE (`BaselineLike`, structural, so this never imports Save) and the
// engine as a service.

import { Result } from "effect";

import { Refusal, trustedBy, type Book, type BookId, type Receipt } from "../book/book";
import type { DecisionUnit, GalleyService } from "../galley";
import type { SourceStamp } from "../source/source";
import { diffSkeleton } from "./skeleton";

/**
 * The shape of a saved baseline this needs: which book, its stamp, its text.
 * Save's `Baseline` and a decoded recorded blob both satisfy it.
 */
export interface BaselineLike {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
  readonly text: string;
}

/**
 * One book's changes against one baseline, as the engine's units.
 *
 * `stamp` is the WORKING text's, taken when this was computed: units computed
 * from one revision mean nothing against another, so a revert checks it and
 * refuses `Stale` rather than splicing at offsets that moved.
 */
export interface UnitChanges {
  readonly bookId: BookId;
  readonly stamp: SourceStamp;
  readonly baselineText: string;
  readonly workingText: string;
  /** The changed units, in the engine's order; empty when the texts are identical. */
  readonly units: readonly DecisionUnit[];
}

/**
 * The changed units between a baseline and the book's current text. Identical
 * texts — the common case — answer by string equality with no engine call.
 */
export const unitChanges = (
  galley: GalleyService,
  book: Book,
  baseline: BaselineLike,
): Result.Result<UnitChanges, Refusal> => {
  const source = book.source();
  const base = {
    bookId: baseline.bookId,
    stamp: source.stamp,
    baselineText: baseline.text,
    workingText: source.text,
  };
  if (baseline.text === source.text) return Result.succeed({ ...base, units: [] });
  const found = diffSkeleton(galley, baseline.bookId, baseline.text, source.text);
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

/**
 * Puts the baseline's text back for `units`, as ONE trusted `revert` through
 * the one write path — so one Undo takes the whole revert back, whether it is
 * one verse or the whole book.
 *
 * The edits are the engine's (`mergeSplices`, with the book's text as the
 * text being edited): only the chosen units move, and everything else keeps
 * its offsets. Unit ids are the same whichever way round the two texts are
 * diffed, so the ids `unitChanges` reported are the ids the merge takes.
 */
export const revertUnits = (
  galley: GalleyService,
  book: Book,
  changes: UnitChanges,
  units: readonly DecisionUnit[],
): Result.Result<Receipt, Refusal> => {
  // An empty list would still count a revision in the Book, so it is refused
  // rather than quietly stamping a no-op edit into history.
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
