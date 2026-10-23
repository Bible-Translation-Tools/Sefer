import type { EditorBook } from "@sefer/editor";
import { trustedBy, type BookId } from "@sefer/text/book";
import { Effect, Result } from "effect";

import type { DecisionUnit, MergeSide } from "#core/galley";

import { describe } from "../../../describe";
import type { Shell } from "../../../ProjectContext";
import type { Services } from "../../../services";
import type { Decisions } from "./createDecisions";
import type { Sides } from "./createSides";
import type { Units } from "./createUnits";

export interface WritesInputs {
  readonly shell: Shell;
  readonly services: Services;
  readonly sides: Sides;
  readonly decisions: Decisions;
  readonly units: Units;
  readonly setNote: (note: string) => void;
}

type Operation = ReturnType<Services["composition"]["observability"]["operation"]>;

function applyTaken(
  inputs: WritesInputs,
  operation: Operation,
  book: NonNullable<ReturnType<NonNullable<ReturnType<Shell["project"]>>["book"]>>,
  bookId: BookId,
  live: string,
  from: string,
  chosen: readonly DecisionUnit[],
): void {
  const { shell, services, setNote } = inputs;
  const merged = services.galley.merge(
    from,
    live,
    new Map(chosen.map((unit) => [unit.id, "baseline" as const])),
    "current",
  );
  if (Result.isFailure(merged)) {
    operation.end("refused", { "review.reason": "merge" });
    setNote(merged.failure.description);
    return;
  }
  const splices = services.galley.mergeSplices(live, merged.success, new Map(), "current");
  if (Result.isFailure(splices)) {
    operation.end("refused", { "review.reason": "merge" });
    setNote(splices.failure.description);
    return;
  }
  if (splices.success.length === 0) {
    operation.end("passed", { "review.wrote": false });
    return;
  }
  const applied = book.apply(splices.success, "compare", trustedBy("compare"));
  operation.end(Result.isSuccess(applied) ? "passed" : "refused", {
    "review.wrote": Result.isSuccess(applied),
    "review.splices": splices.success.length,
  });
  if (Result.isFailure(applied)) setNote(describe(applied.failure));
  shell.changed({ kind: "book.apply", books: [bookId] });
}

function writeNow(
  inputs: WritesInputs,
  bookId: BookId,
  staticUnits: readonly DecisionUnit[],
  side: MergeSide | undefined,
): void {
  const { shell, services } = inputs;
  const { originals, decide, decisionFor } = inputs.decisions;
  const book = shell.project()?.book(bookId);
  const other = inputs.units.reviewBooks().find((entry) => entry.bookId === bookId);
  const live = book?.source().text;
  if (book === undefined || other === undefined || live === undefined) return;
  const taking = side === "baseline";
  const putBack = staticUnits.filter((unit) => decisionFor(bookId, unit.id) === "baseline");
  const operation = services.composition.observability.operation("review.diff.take", {
    "review.book": bookId,
    "review.units": staticUnits.length,
    "review.side": side ?? "clear",
  });
  const from = taking ? other.baselineText : originals.get(bookId);
  const chosen = taking ? staticUnits : putBack;
  if (taking && !originals.has(bookId)) originals.set(bookId, live);
  decide(bookId, staticUnits, side);
  if (from === undefined || chosen.length === 0) {
    operation.end("passed", { "review.wrote": false });
    return;
  }
  applyTaken(inputs, operation, book, bookId, live, from, chosen);
}

export function createWrites(inputs: WritesInputs) {
  const { shell, services } = inputs;
  const { leftId, target } = inputs.sides;
  const { decisionFor } = inputs.decisions;
  const { preset } = inputs.units;

  const editable = (): boolean => target() === "left" && leftId() === "project";

  const write = (
    bookId: BookId,
    staticUnits: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ): void => writeNow(inputs, bookId, staticUnits, side);

  const decideAny = (
    bookId: BookId,
    staticUnits: readonly DecisionUnit[],
    side: MergeSide | undefined,
  ): void => {
    if (!editable()) return;
    const putBackPreset =
      side === undefined &&
      staticUnits.length > 0 &&
      staticUnits.every(
        (unit) => decisionFor(bookId, unit.id) === undefined && preset(bookId, unit) === "baseline",
      );
    write(bookId, staticUnits, putBackPreset ? "current" : side);
  };

  const seatBook = async (bookId: BookId): Promise<EditorBook | undefined> => {
    const project = shell.project();
    if (project === undefined) return undefined;
    const opened = await services.run(Effect.result(project.instantiate(bookId)));
    if (Result.isFailure(opened)) return undefined;
    return services.seated(bookId);
  };

  return { editable, writeNow: write, decideAny, seatBook };
}

export type Writes = ReturnType<typeof createWrites>;
